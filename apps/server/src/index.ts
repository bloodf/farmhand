import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { consoleLog, createDeps } from "./deps.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const version = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
const deps = await createDeps(env, { version, jobs: true });
const { app } = createApp(deps);

// One listener per address: loopback for a reverse proxy, a LAN address for direct use.
const hosts = env.FARMHAND_HOST.split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const servers = hosts.map((hostname) =>
  serve({ fetch: app.fetch, port: env.FARMHAND_PORT, hostname }, (info) =>
    consoleLog.info({ port: info.port, host: info.address, version }, "farmhand listening"),
  ),
);

const shutdown = () => {
  let open = servers.length;
  for (const server of servers) {
    // Open SSE streams would keep close() waiting forever.
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close(() => {
      if (--open === 0) void deps.close().then(() => process.exit(0));
    });
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
