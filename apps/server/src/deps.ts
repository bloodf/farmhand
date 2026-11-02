/** Everything a route can reach. Built once at boot, or per test with an in-memory DB. */
import { type Auth, createAuth } from "./auth.js";
import { createDb, type Db } from "./db/client.js";
import type { Env } from "./env.js";
import { ConfirmTokens } from "./lib/confirm-token.js";
import { Operations } from "./lib/operations.js";
import { SettingsStore } from "./lib/settings.js";

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
  confirm: ConfirmTokens;
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

export async function createDeps(
  env: Env,
  opts: { version?: string; log?: Log } = {},
): Promise<Deps & { close: () => void }> {
  const { db, client, migrate } = createDb(env.FARMHAND_DB);
  await migrate();
  const auth = createAuth(db, env);
  const operations = new Operations(db);
  await operations.closeStale();
  return {
    env,
    version: opts.version ?? "dev",
    db,
    auth,
    operations,
    settings: new SettingsStore(db),
    confirm: new ConfirmTokens(env.BETTER_AUTH_SECRET),
    log: opts.log ?? consoleLog,
    close: () => client.close(),
  };
}
