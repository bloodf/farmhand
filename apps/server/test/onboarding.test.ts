import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeApps, createFakeMoonraker, FIXTURE_PASSWORD, FIXTURE_USER } from "@farmhand/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeHelper } from "../src/adapters/helper.js";
import { harness } from "./harness.js";

const P = { mr1: 47125, mr2: 47126, printstash: 43460, fdm: 48400, spoolman: 47912 };
const mr1 = createFakeMoonraker({ name: "gamma", port: P.mr1, state: "standby", tickMs: 0 });
const mr2 = createFakeMoonraker({ name: "delta", port: P.mr2, state: "standby", tickMs: 0 });
const apps = createFakeApps({ printstashPort: P.printstash, fdmPort: P.fdm, spoolmanPort: P.spoolman });
const dir = mkdtempSync(join(tmpdir(), "farmhand-helper-"));

let h: Awaited<ReturnType<typeof harness>>;
let op: Awaited<ReturnType<typeof h.userWithRole>>;
let helper: FakeHelper;

beforeAll(async () => {
  mr1.start();
  mr2.start();
  apps.start();
  h = await harness(
    {
      PRINTSTASH_URL: `http://127.0.0.1:${P.printstash}`,
      PRINTSTASH_USER: FIXTURE_USER,
      PRINTSTASH_PASSWORD: FIXTURE_PASSWORD,
      FDM_URL: `http://127.0.0.1:${P.fdm}`,
      FDM_USER: FIXTURE_USER,
      FDM_PASSWORD: FIXTURE_PASSWORD,
      SPOOLMAN_URL: `http://127.0.0.1:${P.spoolman}`,
      FARMHAND_FAKE_HELPER_DIR: dir,
    },
    {
      discovery: {
        sources: async () => [
          { host: "127.0.0.1", port: P.mr1, source: "mdns" },
          { host: "127.0.0.1", port: P.mr2, source: "neigh" },
          { host: "127.0.0.1", port: 47199, source: "neigh" },
        ],
      },
    },
  );
  await h.setup();
  op = await h.userWithRole("operator");
  helper = h.deps.helper as FakeHelper;
});
afterAll(async () => {
  await h.close();
  await Promise.all([mr1.stop(), mr2.stop(), apps.stop()]);
});

const j = async <T>(r: Response) => (await r.json()) as T;
type Steps = { id: string; status: string }[];
const statuses = (steps: Steps) => Object.fromEntries(steps.map((s) => [s.id, s.status]));

describe("discovery", () => {
  it("records only hosts that speak Moonraker and emits candidates", async () => {
    expect((await op.post("/api/discovery/run")).status).toBe(202);
    const started = Date.now();
    while (h.deps.discovery.isRunning && Date.now() - started < 5000)
      await new Promise((r) => setTimeout(r, 20));
    const { items } = await j<{ items: { host: string; port: number; name: string; source: string }[] }>(
      await op.get("/api/candidates"),
    );
    expect(items.map((c) => [c.port, c.name, c.source])).toEqual([
      [P.mr1, "gamma", "mdns"],
      [P.mr2, "delta", "neigh"],
    ]);
    expect(h.deps.live.discovery.lastRunAt).not.toBeNull();
  });

  it("viewer cannot run discovery", async () => {
    const viewer = await h.userWithRole("viewer");
    expect((await viewer.post("/api/discovery/run")).status).toBe(403);
  });

  it("manual probe rejects bad targets and records good ones", async () => {
    expect(await j(await op.post("/api/discovery/probe", { ip: "8.8.8.8", port: 7125 }))).toMatchObject({
      code: "rejected",
      reason: "outside_lan",
    });
    expect(await j(await op.post("/api/discovery/probe", { ip: "127.0.0.1", port: 47199 }))).toMatchObject({
      code: "rejected",
      reason: "refused",
    });
    const ok = await j<{ identity: { hostname: string }; candidate: { source: string } }>(
      await op.post("/api/discovery/probe", { ip: "127.0.0.1", port: P.mr2 }),
    );
    expect(ok.identity.hostname).toBe("delta");
    expect(ok.candidate.source).toBe("neigh"); // already known from discovery; source is kept
  });

  it("dismiss hides a candidate", async () => {
    expect((await op.post(`/api/candidates/127.0.0.1/${P.mr2}/dismiss`)).status).toBe(200);
    const { items } = await j<{ items: { port: number }[] }>(await op.get("/api/candidates"));
    expect(items.map((c) => c.port)).toEqual([P.mr1]);
  });
});

describe("approval", () => {
  let token = "";
  const input = { ip: "127.0.0.1", port: P.mr1 };

  it("preview shows four 'add' effects and mints a token", async () => {
    const r = await j<{
      printer: { name: string };
      effects: { id: string; willDo: string }[];
      confirmToken: string;
    }>(await op.post("/api/approvals/preview", input));
    expect(r.printer.name).toBe("gamma");
    expect(r.effects.map((e) => e.willDo)).toEqual(["add", "add", "add", "add"]);
    token = r.confirmToken;
  });

  it("refuses a token with a different target", async () => {
    const res = await op.post("/api/approvals", {
      confirmToken: token,
      host: "127.0.0.1",
      port: P.mr2,
      name: "gamma",
    });
    expect(res.status).toBe(403);
    expect(await j(res)).toMatchObject({ code: "bad_token", reason: "mismatch" });
  });

  it("runs all steps; FDM failure gives partial; repair fixes only fdm", async () => {
    apps.state.fdmFail = true;
    const res = await op.post("/api/approvals", {
      confirmToken: token,
      host: "127.0.0.1",
      port: P.mr1,
      name: "gamma",
    });
    expect(res.status).toBe(200);
    const r = await j<{ operationId: string; printerId: string; steps: Steps }>(res);
    expect(statuses(r.steps)).toEqual({
      allowlist: "success",
      printstash: "success",
      fdm: "failed",
      mobileraker: "success",
    });
    expect(readFileSync(join(dir, "printers.allow"), "utf8")).toContain("127.0.0.1");
    expect(readFileSync(join(dir, "mobileraker.conf"), "utf8")).toContain(
      `ws://127.0.0.1:${P.mr1}/websocket`,
    );
    const opRow = await j<{ status: string }>(await op.get(`/api/operations/${r.operationId}`));
    expect(opRow.status).toBe("partial");

    // replay of the same token is refused
    expect(
      (
        await op.post("/api/approvals", {
          confirmToken: token,
          host: "127.0.0.1",
          port: P.mr1,
          name: "gamma",
        })
      ).status,
    ).toBe(403);

    // the printer exists with the partial checklist and is no longer a candidate
    const printer = await j<{ integrations: Record<string, { status: string }>; source: string }>(
      await op.get(`/api/printers/${r.printerId}`),
    );
    expect(printer.integrations.fdm?.status).toBe("failed");
    expect(printer.source).toBe("manual");
    const { items } = await j<{ items: unknown[] }>(await op.get("/api/candidates"));
    expect(items).toEqual([]);

    apps.state.fdmFail = false;
    const rep = await j<{ steps: Steps }>(
      await op.post(`/api/printers/${r.printerId}/repair`, { confirm: true }),
    );
    expect(statuses(rep.steps)).toEqual({
      allowlist: "skipped",
      printstash: "skipped",
      fdm: "success",
      mobileraker: "skipped",
    });
    expect(apps.state.fdm.map((p) => p.name)).toEqual(["gamma"]);
    expect(apps.state.printstash.map((p) => p.name)).toEqual(["gamma"]);
  });

  it("approving again reports already_configured everywhere", async () => {
    const pre = await j<{ effects: { willDo: string }[]; confirmToken: string }>(
      await op.post("/api/approvals/preview", input),
    );
    expect(pre.effects.map((e) => e.willDo)).toEqual(["already", "already", "already", "already"]);
    const r = await j<{ steps: Steps }>(
      await op.post("/api/approvals", {
        confirmToken: pre.confirmToken,
        host: "127.0.0.1",
        port: P.mr1,
        name: "gamma",
      }),
    );
    expect(Object.values(statuses(r.steps))).toEqual([
      "already_configured",
      "already_configured",
      "already_configured",
      "already_configured",
    ]);
    expect(apps.state.printstash).toHaveLength(1);
    expect(readFileSync(join(dir, "mobileraker.conf"), "utf8").match(/\[printer /g)).toHaveLength(1);
  });

  it("diagnostics refresh the checklist from live sources", async () => {
    const { items } = await j<{ items: { id: string }[] }>(await op.get("/api/printers"));
    const id = items[0]?.id ?? "";
    const d = await j<{ moonraker: { ok: boolean }; effects: { willDo: string }[] }>(
      await op.post(`/api/printers/${id}/diagnostics`),
    );
    expect(d.moonraker.ok).toBe(true);
    expect(d.effects.every((e) => e.willDo === "already")).toBe(true);
  });

  it("rejects preview outside the LAN and for a non-Moonraker host", async () => {
    expect(await j(await op.post("/api/approvals/preview", { ip: "8.8.8.8", port: 7125 }))).toMatchObject({
      code: "rejected",
      reason: "outside_lan",
    });
    expect(await j(await op.post("/api/approvals/preview", { ip: "127.0.0.1", port: 47199 }))).toMatchObject({
      code: "rejected",
      reason: "refused",
    });
    expect(
      (await op.post("/api/approvals/preview", { ip: "127.0.0.1", port: P.mr1, name: "bad]name" })).status,
    ).toBe(400);
  });

  it("returns busy while another farm mutation holds the lock", async () => {
    const release = h.deps.lock.tryAcquire("test");
    expect(release).not.toBeNull();
    const pre = await j<{ confirmToken: string }>(await op.post("/api/approvals/preview", input));
    expect(
      (
        await op.post("/api/approvals", {
          confirmToken: pre.confirmToken,
          host: "127.0.0.1",
          port: P.mr1,
          name: "gamma",
        })
      ).status,
    ).toBe(409);
    release?.();
    expect(helper.restarted).toEqual([]);
  });
});
