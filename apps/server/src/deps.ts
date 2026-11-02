/** Everything a route can reach. Built once at boot, or per test with an in-memory DB. */
import { FdmMonster } from "./adapters/fdm-monster.js";
import { createHelper, type Helper } from "./adapters/helper.js";
import { PrintStash } from "./adapters/printstash.js";
import { Spoolman } from "./adapters/spoolman.js";
import { Approval } from "./approval/index.js";
import { type Auth, createAuth } from "./auth.js";
import { createDb, type Db } from "./db/client.js";
import type { Env } from "./env.js";
import { adoptFromPrintStash } from "./jobs/adopt.js";
import { Discovery, type DiscoveryDeps } from "./jobs/discovery.js";
import { Fleet } from "./jobs/fleet.js";
import { Candidates } from "./lib/candidates.js";
import { ConfirmTokens } from "./lib/confirm-token.js";
import { FarmLock } from "./lib/farm-lock.js";
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
  discovery: Discovery;
  approval: Approval;
  helper: Helper;
  lock: FarmLock;
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
  /** Start background jobs (subscribers, health, stock, discovery timer). Tests usually leave this off. */
  jobs?: boolean;
  /** Test seams for discovery sources and host networks. */
  discovery?: Partial<Pick<DiscoveryDeps, "sources" | "nets">>;
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
  let cachedIfaces: readonly string[] = (await settings.read()).lanIfaces;
  settings.onChange((s) => {
    cachedIfaces = s.lanIfaces;
  });
  const printstash = new PrintStash({
    url: env.PRINTSTASH_URL,
    user: env.PRINTSTASH_USER,
    password: env.PRINTSTASH_PASSWORD,
  });
  const fdm = new FdmMonster({ url: env.FDM_URL, user: env.FDM_USER, password: env.FDM_PASSWORD });
  const spoolman = new Spoolman(env.SPOOLMAN_URL);
  const fleet = new Fleet({ env, db, live, settings, printstash, fdm, spoolman });
  const helper = createHelper(env.FARMHAND_HELPER, env.FARMHAND_FAKE_HELPER_DIR);
  const discovery = new Discovery({ env, db, live, settings, log, ...opts.discovery });
  const approval = new Approval({
    db,
    helper,
    printstash,
    fdm,
    operations,
    onPrintersChanged: () => fleet.reconcileSubscribers(),
    lanIfaces: () => cachedIfaces,
    allowLoopback: env.FARMHAND_DEV_ALLOW_LOOPBACK,
  });
  if (opts.jobs) {
    await adoptFromPrintStash(db, printstash, log, {
      lanIfaces: (await settings.read()).lanIfaces,
      allowLoopback: env.FARMHAND_DEV_ALLOW_LOOPBACK,
    });
    await fleet.start();
    discovery.start();
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
    discovery,
    approval,
    helper,
    lock: new FarmLock(),
    printstash,
    fdm,
    spoolman,
    log,
    close: async () => {
      fleet.stop();
      discovery.stop();
      client.close();
    },
  };
}
