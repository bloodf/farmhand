/** Everything a route can reach. Built once at boot, or per test with an in-memory DB. */
import { FdmMonster } from "./adapters/fdm-monster.js";
import { PrintStash } from "./adapters/printstash.js";
import { Spoolman } from "./adapters/spoolman.js";
import { type Auth, createAuth } from "./auth.js";
import { createDb, type Db } from "./db/client.js";
import type { Env } from "./env.js";
import { adoptFromPrintStash } from "./jobs/adopt.js";
import { Fleet } from "./jobs/fleet.js";
import { Candidates } from "./lib/candidates.js";
import { ConfirmTokens } from "./lib/confirm-token.js";
import { Operations } from "./lib/operations.js";
import { SettingsStore } from "./lib/settings.js";
import { LiveStore } from "./live/store.js";

export interface Log {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface Deps {
  env: Env;
  version: string;
  db: Db;
  auth: Auth;
  operations: Operations;
  settings: SettingsStore;
  candidates: Candidates;
  confirm: ConfirmTokens;
  live: LiveStore;
  fleet: Fleet;
  printstash: PrintStash;
  fdm: FdmMonster;
  spoolman: Spoolman;
  log: Log;
}

export const consoleLog: Log = {
  info: (o, m) => process.stdout.write(`${JSON.stringify({ level: "info", msg: m, ...o })}\n`),
  warn: (o, m) => process.stderr.write(`${JSON.stringify({ level: "warn", msg: m, ...o })}\n`),
  error: (o, m) =>
    process.stderr.write(
      `${JSON.stringify({ level: "error", msg: m, ...o, err: o.err instanceof Error ? o.err.stack : o.err })}\n`,
    ),
};

export interface CreateDepsOptions {
  version?: string;
  log?: Log;
  /** Start background jobs (subscribers, health, stock). Tests usually leave this off. */
  jobs?: boolean;
}

export async function createDeps(
  env: Env,
  opts: CreateDepsOptions = {},
): Promise<Deps & { close: () => Promise<void> }> {
  const log = opts.log ?? consoleLog;
  const { db, client, migrate } = createDb(env.FARMHAND_DB);
  await migrate();
  const auth = createAuth(db, env);
  const live = new LiveStore();
  const operations = new Operations(db, (op) =>
    live.emit({ type: "operation", id: op.id, kind: op.kind, status: op.status, steps: op.steps }),
  );
  await operations.closeStale();
  const settings = new SettingsStore(db);
  const printstash = new PrintStash({
    url: env.PRINTSTASH_URL,
    user: env.PRINTSTASH_USER,
    password: env.PRINTSTASH_PASSWORD,
  });
  const fdm = new FdmMonster({ url: env.FDM_URL, user: env.FDM_USER, password: env.FDM_PASSWORD });
  const spoolman = new Spoolman(env.SPOOLMAN_URL);
  const fleet = new Fleet({ env, db, live, settings, printstash, fdm, spoolman });
  if (opts.jobs) {
    await adoptFromPrintStash(db, printstash, log);
    await fleet.start();
  }
  return {
    env,
    version: opts.version ?? "dev",
    db,
    auth,
    operations,
    settings,
    candidates: new Candidates(db),
    confirm: new ConfirmTokens(env.BETTER_AUTH_SECRET),
    live,
    fleet,
    printstash,
    fdm,
    spoolman,
    log,
    close: async () => {
      fleet.stop();
      client.close();
    },
  };
}
