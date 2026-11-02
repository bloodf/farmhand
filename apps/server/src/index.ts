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

const server = serve({ fetch: app.fetch, port: env.FARMHAND_PORT, hostname: env.FARMHAND_HOST }, (info) =>
  consoleLog.info({ port: info.port, host: info.address, version }, "farmhand listening"),
);

const shutdown = () => {
  server.close(() => {
    void deps.close().then(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
