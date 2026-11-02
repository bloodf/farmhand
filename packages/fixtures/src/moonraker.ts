/**
 * Fake Moonraker: enough HTTP + WebSocket JSON-RPC for farmhand's pollers,
 * discovery probe and onboarding. Simulates a print job so the UI has motion.
 * Never used in production.
 */
import { type ServerType, serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";

export type JobState = "standby" | "printing" | "paused" | "complete" | "cancelled" | "error";

export interface FakePrinterOptions {
  name: string;
  port: number;
  host?: string;
  state?: JobState;
  filename?: string;
  /** Advance the simulation every N ms. 0 disables the timer (tests call tick()). */
  tickMs?: number;
}

export interface PrinterStatus {
  print_stats: { state: JobState; filename: string; print_duration: number; message: string };
  virtual_sdcard: { progress: number; is_active: boolean };
  display_status: { progress: number; message: string | null };
  extruder: { temperature: number; target: number };
  heater_bed: { temperature: number; target: number };
  webhooks: { state: "ready" | "startup" | "shutdown" | "error"; state_message: string };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function createFakeMoonraker(opts: FakePrinterOptions) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const sockets = new Set<WSContext>();
  let offline = false;
  let eventtime = 1000;
  const status: PrinterStatus = {
    print_stats: {
      state: opts.state ?? "standby",
      filename: opts.filename ?? "",
      print_duration: 0,
      message: "",
    },
    virtual_sdcard: { progress: 0, is_active: opts.state === "printing" },
    display_status: { progress: 0, message: null },
    extruder: { temperature: 24, target: opts.state === "printing" ? 215 : 0 },
    heater_bed: { temperature: 23, target: opts.state === "printing" ? 60 : 0 },
    webhooks: { state: "ready", state_message: "Printer is ready" },
  };

  const broadcast = (payload: unknown) => {
    const text = JSON.stringify(payload);
    for (const ws of sockets) ws.send(text);
  };

  const approach = (cur: number, target: number) => round(cur + (target - cur) * 0.2);

  function tick() {
    eventtime += 1;
    const ps = status.print_stats;
    if (ps.state === "printing") {
      ps.print_duration += 1;
      status.virtual_sdcard.progress = round(Math.min(1, status.virtual_sdcard.progress + 0.01));
      status.display_status.progress = status.virtual_sdcard.progress;
      if (status.virtual_sdcard.progress >= 1) {
        ps.state = "complete";
        status.virtual_sdcard.is_active = false;
        status.extruder.target = 0;
        status.heater_bed.target = 0;
      }
    }
    status.extruder.temperature = approach(status.extruder.temperature, status.extruder.target || 24);
    status.heater_bed.temperature = approach(status.heater_bed.temperature, status.heater_bed.target || 23);
    if (!offline) {
      broadcast({
        jsonrpc: "2.0",
        method: "notify_status_update",
        params: [
          {
            print_stats: { ...ps },
            virtual_sdcard: { ...status.virtual_sdcard },
            extruder: { ...status.extruder },
            heater_bed: { ...status.heater_bed },
          },
          eventtime,
        ],
      });
    }
  }

  function setState(next: JobState, filename?: string) {
    status.print_stats.state = next;
    if (filename !== undefined) status.print_stats.filename = filename;
    const printing = next === "printing";
    status.virtual_sdcard.is_active = printing;
    status.extruder.target = printing ? 215 : 0;
    status.heater_bed.target = printing ? 60 : 0;
    if (next === "standby") {
      status.virtual_sdcard.progress = 0;
      status.print_stats.print_duration = 0;
    }
  }

  function setOffline(next: boolean) {
    offline = next;
    if (offline) {
      for (const ws of sockets) ws.close();
      sockets.clear();
    }
  }

  function setKlippy(state: PrinterStatus["webhooks"]["state"]) {
    status.webhooks.state = state;
    status.webhooks.state_message = `Klippy ${state}`;
    const method =
      state === "ready" ? "notify_klippy_ready" : state === "shutdown" ? "notify_klippy_shutdown" : null;
    if (method) broadcast({ jsonrpc: "2.0", method });
  }

  const serverInfo = () => ({
    klippy_connected: status.webhooks.state !== "shutdown",
    klippy_state: status.webhooks.state,
    moonraker_version: "v0.9.3-fixture",
    components: ["server", "spoolman"],
  });

  app.use("*", async (c, next) => {
    if (offline) return c.text("fixture offline", 503);
    await next();
  });
  app.get("/server/info", (c) => c.json({ result: serverInfo() }));
  app.get("/printer/info", (c) =>
    c.json({
      result: {
        hostname: opts.name,
        state: status.webhooks.state,
        state_message: status.webhooks.state_message,
      },
    }),
  );
  app.get("/server/spoolman/status", (c) =>
    c.json({ result: { spoolman_connected: true, pending_reports: [] } }),
  );
  app.get("/printer/objects/query", (c) => c.json({ result: { eventtime, status } }));
  app.get("/__state", (c) => c.json({ offline, status }));
  app.post("/__control", async (c) => {
    const body = (await c.req.json()) as {
      offline?: boolean;
      state?: JobState;
      filename?: string;
      klippy?: PrinterStatus["webhooks"]["state"];
    };
    if (body.offline !== undefined) setOffline(body.offline);
    if (body.state) setState(body.state, body.filename);
    if (body.klippy) setKlippy(body.klippy);
    return c.json({ ok: true });
  });

  app.get(
    "/websocket",
    upgradeWebSocket(() => ({
      onOpen(_e, ws) {
        sockets.add(ws);
      },
      onClose(_e, ws) {
        sockets.delete(ws);
      },
      onMessage(e, ws) {
        let req: { id?: number; method?: string; params?: { objects?: Record<string, string[] | null> } };
        try {
          req = JSON.parse(String(e.data));
        } catch {
          return;
        }
        const reply = (result: unknown) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
        switch (req.method) {
          case "server.info":
            return reply(serverInfo());
          case "printer.info":
            return reply({ hostname: opts.name, state: status.webhooks.state });
          case "server.connection.identify":
            return reply({ connection_id: 1 });
          case "printer.objects.subscribe": {
            const wanted = Object.keys(req.params?.objects ?? {});
            const picked = Object.fromEntries(
              wanted.filter((k) => k in status).map((k) => [k, status[k as keyof PrinterStatus]]),
            );
            return reply({ eventtime, status: picked });
          }
          default:
            return ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: req.id,
                error: { code: -32601, message: "Method not found" },
              }),
            );
        }
      },
    })),
  );

  let server: ServerType | undefined;
  let timer: NodeJS.Timeout | undefined;

  return {
    app,
    name: opts.name,
    port: opts.port,
    tick,
    setState,
    setOffline,
    setKlippy,
    start() {
      server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host ?? "127.0.0.1" });
      injectWebSocket(server);
      const ms = opts.tickMs ?? 1000;
      if (ms > 0) timer = setInterval(tick, ms);
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      for (const ws of sockets) ws.close();
      sockets.clear();
      return new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
}

export type FakeMoonraker = ReturnType<typeof createFakeMoonraker>;
