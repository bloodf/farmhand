/**
 * Onboarding a printer: probe Moonraker, then four independent, idempotent
 * steps. Preview reports what each step would do; run executes and records
 * per-step results. Repair re-runs only failed/unknown steps.
 */
import { randomUUID } from "node:crypto";
import { checkTarget, nameProblem, STEP_IDS, type Step, type StepId } from "@farmhand/contracts";
import { eq } from "drizzle-orm";
import type { FdmMonster } from "../adapters/fdm-monster.js";
import type { Helper } from "../adapters/helper.js";
import { moonrakerHttp, probeMoonraker } from "../adapters/moonraker.js";
import type { PrintStash } from "../adapters/printstash.js";
import type { Db } from "../db/client.js";
import { type Integrations, printers } from "../db/schema.js";
import type { Operations } from "../lib/operations.js";

export interface ApprovalDeps {
  db: Db;
  helper: Helper;
  printstash: PrintStash;
  fdm: FdmMonster;
  operations: Operations;
  onPrintersChanged: () => Promise<void>;
  lanIfaces: () => readonly string[];
  allowLoopback: boolean;
  /** `ip:port` bridges on this host: they pass own_address and never go into the Spoolman allowlist. */
  bridgeTargets: readonly string[];
}

export type Effect = { id: StepId; willDo: "add" | "already" | "unknown"; detail: string };

export class Approval {
  constructor(private readonly d: ApprovalDeps) {}

  /** What approving host:port would change right now. */
  async preview(host: string, port: number) {
    const bridge = this.d.bridgeTargets.includes(`${host}:${port}`);
    const probe = await probeMoonraker(host, port);
    if (!probe.ok) return { ok: false as const, code: "not_moonraker" as const, error: probe.error };
    const url = moonrakerHttp(host, port);
    const wsUri = `ws://${host}:${port}/websocket`;
    const [allow, ps, fdm, mr] = await Promise.all([
      this.d.helper.allowlistList(),
      this.d.printstash.registered(),
      this.d.fdm.registered(),
      this.d.helper.mobilerakerList(),
    ]);
    const eff = (id: StepId, r: { ok: boolean; error?: string; code?: string }, present: boolean): Effect =>
      r.ok
        ? { id, willDo: present ? "already" : "add", detail: present ? "present" : "missing" }
        : { id, willDo: "unknown", detail: r.error ?? r.code ?? "unavailable" };
    // A bridge is this host itself: its address must never go into printers.allow, so the step is left out.
    const effects: Effect[] = [
      ...(bridge ? [] : [eff("allowlist", allow, allow.ok && allow.ips.includes(host))]),
      eff("printstash", ps, ps.ok && ps.urls.has(url)),
      eff("fdm", fdm, fdm.ok && fdm.urls.has(url)),
      eff("mobileraker", mr, mr.ok && mr.uris.includes(wsUri)),
    ];
    return { ok: true as const, identity: probe.identity, effects };
  }

  /** Full approval. Creates the printer row after the probe passes, then runs every step. */
  async approve(
    input: { host: string; port: number; name: string },
    actor: { id: string; ip: string | null },
  ) {
    const probe = await probeMoonraker(input.host, input.port);
    if (!probe.ok) return { ok: false as const, code: "not_moonraker" as const, error: probe.error };
    const opId = await this.d.operations.open("approve", actor, `${input.host}:${input.port}`, input);
    const existing = await this.d.db.query.printers.findFirst({
      where: (t, { and }) => and(eq(t.host, input.host), eq(t.port, input.port)),
    });
    const now = new Date().toISOString();
    const id = existing?.id ?? randomUUID();
    if (!existing) {
      await this.d.db.insert(printers).values({
        id,
        name: input.name,
        host: input.host,
        port: input.port,
        source: "manual",
        approvedAt: now,
        approvedBy: actor.id,
        integrations: pendingIntegrations(now),
        lastSnapshot: null,
        updatedAt: now,
      });
      await this.d.onPrintersChanged();
    }
    const steps = await this.runSteps(id, input, [...STEP_IDS], opId);
    return { ok: true as const, operationId: opId, printerId: id, steps };
  }

  /** Re-run only the steps that are not already successful. */
  async repair(printerId: string, actor: { id: string; ip: string | null }) {
    const row = await this.d.db.query.printers.findFirst({ where: eq(printers.id, printerId) });
    if (!row) return { ok: false as const, code: "not_found" as const };
    const todo = STEP_IDS.filter(
      (s) => !["success", "already_configured"].includes(row.integrations[s].status),
    );
    const opId = await this.d.operations.open("repair", actor, `${row.host}:${row.port}`, {
      printerId,
      steps: todo,
    });
    const steps = await this.runSteps(row.id, { host: row.host, port: row.port, name: row.name }, todo, opId);
    return { ok: true as const, operationId: opId, steps };
  }

  private async runSteps(
    printerId: string,
    input: { host: string; port: number; name: string },
    which: StepId[],
    opId: string,
  ) {
    // Stored rows may predate the current rules (adopted printers, older versions): re-check before any helper step.
    const target = checkTarget(input.host, {
      lan: true,
      lanIfaces: this.d.lanIfaces(),
      allowLoopback: this.d.allowLoopback,
      port: input.port,
      bridgeTargets: this.d.bridgeTargets,
    });
    const nameBad = nameProblem(input.name);
    if (!target.ok || nameBad) {
      const steps: Step[] = STEP_IDS.map((id) => ({
        id,
        status: which.includes(id) ? "failed" : "skipped",
        message: which.includes(id) ? (target.ok ? `name:${nameBad}` : target.code) : "",
      }));
      await this.d.operations.update(opId, { status: "failed", steps });
      return steps;
    }
    const url = moonrakerHttp(input.host, input.port);
    const runners: Record<
      StepId,
      () => Promise<{ ok: true; already: boolean } | { ok: false; error: string }>
    > = {
      allowlist: async () => {
        const r = await this.d.helper.allowlistAdd(input.host);
        return r.ok ? { ok: true, already: r.already } : { ok: false, error: r.code };
      },
      printstash: () => this.d.printstash.register(input.name, url),
      fdm: () => this.d.fdm.register(input.name, url),
      mobileraker: async () => {
        const r = await this.d.helper.mobilerakerAdd(input.host, input.port, input.name);
        return r.ok ? { ok: true, already: r.already } : { ok: false, error: r.code };
      },
    };
    const steps: Step[] = STEP_IDS.filter((s) => !which.includes(s)).map((id) => ({
      id,
      status: "skipped",
      message: "",
    }));
    for (const id of which) {
      let step: Step;
      if (id === "allowlist" && target.bridge) {
        step = { id, status: "skipped", message: "bridge" };
        steps.push(step);
        await this.persistStep(printerId, step);
        continue;
      }
      try {
        const r = await runners[id]();
        step = r.ok
          ? { id, status: r.already ? "already_configured" : "success", message: "" }
          : { id, status: "failed", message: r.error };
      } catch (err) {
        step = { id, status: "unknown", message: (err as Error).name || "error" };
      }
      steps.push(step);
      await this.d.operations.update(opId, { steps: ordered(steps) });
      await this.persistStep(printerId, step);
    }
    const ran = steps.filter((s) => s.status !== "skipped");
    const status = ran.every((s) => s.status === "success" || s.status === "already_configured")
      ? "complete"
      : ran.some((s) => s.status === "success" || s.status === "already_configured")
        ? "partial"
        : "failed";
    await this.d.operations.update(opId, { status, steps: ordered(steps) });
    return ordered(steps);
  }

  private async persistStep(printerId: string, step: Step) {
    const row = await this.d.db.query.printers.findFirst({ where: eq(printers.id, printerId) });
    if (!row) return;
    const integrations: Integrations = {
      ...row.integrations,
      [step.id]: { status: step.status, message: step.message, checkedAt: new Date().toISOString() },
    };
    await this.d.db
      .update(printers)
      .set({ integrations, updatedAt: new Date().toISOString() })
      .where(eq(printers.id, printerId));
  }
}

const ordered = (steps: Step[]) => [...steps].sort((a, b) => STEP_IDS.indexOf(a.id) - STEP_IDS.indexOf(b.id));

export const pendingIntegrations = (at: string): Integrations => {
  const s = { status: "unknown" as const, message: "pending", checkedAt: at };
  return { allowlist: s, printstash: s, fdm: s, mobileraker: s };
};
