/** Audit log. Every mutation opens a row before acting and closes it after. */
import { randomUUID } from "node:crypto";
import type { OperationKind, OperationStatus, Step } from "@farmhand/contracts";
import { desc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { operations } from "../db/schema.js";

const SECRET_KEYS = /pass|secret|token|key|authorization|cookie/i;

/** Drops anything that looks like a credential before it reaches the audit log. */
export function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([k]) => !SECRET_KEYS.test(k))
      .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v]),
  );
}

export interface Actor {
  id: string;
  ip: string | null;
}

export class Operations {
  constructor(
    private readonly db: Db,
    private readonly onChange: (op: typeof operations.$inferSelect) => void = () => {},
  ) {}

  async open(
    kind: OperationKind,
    actor: Actor | null,
    target: string | null,
    input: Record<string, unknown>,
  ) {
    const row: typeof operations.$inferInsert = {
      id: randomUUID(),
      kind,
      actorId: actor?.id ?? null,
      actorIp: actor?.ip ?? null,
      target,
      input: sanitizeInput(input),
      status: "running",
      steps: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    await this.db.insert(operations).values(row);
    this.onChange(row as typeof operations.$inferSelect);
    return row.id;
  }

  /** Audit-only entry for something that already happened: opens and closes in one call. */
  async record(
    kind: OperationKind,
    actor: Actor | null,
    target: string | null,
    input: Record<string, unknown>,
  ) {
    const id = await this.open(kind, actor, target, input);
    await this.update(id, { status: "complete" });
    return id;
  }

  async update(id: string, patch: { status?: OperationStatus; steps?: Step[] }) {
    const finished = patch.status && patch.status !== "running" ? new Date().toISOString() : undefined;
    await this.db
      .update(operations)
      .set({ ...patch, ...(finished ? { finishedAt: finished } : {}) })
      .where(eq(operations.id, id));
    const row = await this.get(id);
    if (row) this.onChange(row);
  }

  get(id: string) {
    return this.db.query.operations.findFirst({ where: eq(operations.id, id) });
  }

  list(opts: { kind?: OperationKind; before?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    return this.db.query.operations.findMany({
      where: (t, { and }) =>
        and(
          opts.kind ? eq(t.kind, opts.kind) : undefined,
          opts.before ? lt(t.startedAt, opts.before) : undefined,
        ),
      orderBy: desc(operations.startedAt),
      limit,
    });
  }

  /** Rows still `running` after a restart can never finish; mark them so the UI never waits on them. */
  async closeStale() {
    await this.db
      .update(operations)
      .set({ status: "unknown", finishedAt: new Date().toISOString() })
      .where(eq(operations.status, "running"));
  }
}
