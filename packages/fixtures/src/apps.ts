/**
 * Fake PrintStash, FDM Monster and Spoolman. Shapes copied from the real
 * 0.15.1 / 2.1.1 / 0.27.1 responses farmhand depends on. State is in memory;
 * `GET /__state` dumps it and `POST /__control` flips failure switches.
 */
import { type ServerType, serve } from "@hono/node-server";
import { Hono } from "hono";

export const FIXTURE_USER = "fixture";
export const FIXTURE_PASSWORD = "fixture-password";
const TOKEN = "fixture-token";

interface Registered {
  name: string;
  url: string;
}

export interface FakeAppsOptions {
  printstashPort: number;
  fdmPort: number;
  spoolmanPort: number;
  host?: string;
}

const authed = (h: string | undefined) => h === `Bearer ${TOKEN}`;

export function createFakeApps(opts: FakeAppsOptions) {
  const state = {
    printstash: [] as Registered[],
    fdm: [] as Registered[],
    fdmFail: false,
    printstashDown: false,
    fdmDown: false,
    spoolmanDown: false,
  };

  const control = (app: Hono) => {
    app.get("/__state", (c) => c.json(state));
    app.post("/__control", async (c) => {
      const body = (await c.req.json()) as Partial<typeof state>;
      for (const k of ["fdmFail", "printstashDown", "fdmDown", "spoolmanDown"] as const) {
        if (typeof body[k] === "boolean") state[k] = body[k];
      }
      return c.json({ ok: true });
    });
  };

  const login = async (c: { req: { json: () => Promise<unknown> } }) => {
    const body = (await c.req.json()) as { username?: string; password?: string };
    return body.username === FIXTURE_USER && body.password === FIXTURE_PASSWORD;
  };

  // --- PrintStash 0.15.x
  const printstash = new Hono();
  control(printstash);
  printstash.use("/api/*", async (c, next) => {
    if (state.printstashDown) return c.text("down", 503);
    await next();
  });
  printstash.get("/api/v1/health", (c) => c.json({ status: "ok" }));
  printstash.post("/api/v1/auth/login", async (c) =>
    (await login(c)) ? c.json({ access_token: TOKEN, token_type: "bearer" }) : c.json({ detail: "bad" }, 401),
  );
  printstash.get("/api/v1/printers", (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({}, 401);
    return c.json(
      state.printstash.map((p, i) => ({
        id: i + 1,
        name: p.name,
        provider: "moonraker",
        moonraker_url: p.url,
      })),
    );
  });
  printstash.post("/api/v1/printers", async (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({}, 401);
    const body = (await c.req.json()) as { name: string; moonraker_url: string };
    state.printstash.push({ name: body.name, url: body.moonraker_url });
    return c.json({ id: state.printstash.length, ...body }, 201);
  });

  // --- FDM Monster 2.1.x
  const fdm = new Hono();
  control(fdm);
  fdm.use("/api/*", async (c, next) => {
    if (state.fdmDown) return c.text("down", 503);
    await next();
  });
  fdm.get("/api/v2/test", (c) => c.json({ message: "ok" }));
  fdm.post("/api/v2/auth/login", async (c) =>
    (await login(c)) ? c.json({ token: TOKEN, refreshToken: "r" }) : c.json({}, 401),
  );
  fdm.get("/api/v2/printer", (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({}, 401);
    return c.json(
      state.fdm.map((p, i) => ({
        id: i + 1,
        name: p.name,
        printerURL: p.url,
        printerType: 1,
        enabled: true,
      })),
    );
  });
  fdm.post("/api/v2/printer", async (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({}, 401);
    const body = (await c.req.json()) as { name: string; printerURL: string };
    // The real FDM Monster probes the printer when it is created.
    try {
      const r = await fetch(`${body.printerURL}/server/info`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return c.json({ error: "printer unreachable" }, 502);
    } catch {
      return c.json({ error: "printer unreachable" }, 502);
    }
    if (state.fdmFail) return c.json({ error: "fixture forced failure" }, 502);
    state.fdm.push({ name: body.name, url: body.printerURL });
    return c.json({ id: state.fdm.length, ...body }, 201);
  });

  // --- Spoolman 0.27.x
  const spoolman = new Hono();
  control(spoolman);
  spoolman.use("/api/*", async (c, next) => {
    if (state.spoolmanDown) return c.text("down", 503);
    await next();
  });
  spoolman.get("/api/v1/health", (c) => c.json({ status: "healthy" }));
  spoolman.get("/api/v1/spool", (c) =>
    c.json([
      spool(1, "PLA", "Galaxy Black", 612.4),
      spool(2, "PLA", "Signal White", 180.0),
      spool(3, "PETG", "Clear", 940.2),
      spool(4, "ABS", "Orange", null),
      spool(5, "PLA", "Archived", 10, true),
    ]),
  );

  const servers: ServerType[] = [];
  const host = opts.host ?? "127.0.0.1";
  return {
    apps: { printstash, fdm, spoolman },
    state,
    start() {
      servers.push(serve({ fetch: printstash.fetch, port: opts.printstashPort, hostname: host }));
      servers.push(serve({ fetch: fdm.fetch, port: opts.fdmPort, hostname: host }));
      servers.push(serve({ fetch: spoolman.fetch, port: opts.spoolmanPort, hostname: host }));
      return this;
    },
    stop() {
      return Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))).then(
        () => undefined,
      );
    },
  };
}

function spool(id: number, material: string, name: string, remaining: number | null, archived = false) {
  return {
    id,
    registered: "2026-01-01T00:00:00Z",
    archived,
    remaining_weight: remaining,
    used_weight: remaining === null ? 0 : 1000 - remaining,
    filament: { id, name, material, vendor: { id: 1, name: "Fixture Filaments" }, weight: 1000 },
  };
}

export type FakeApps = ReturnType<typeof createFakeApps>;
