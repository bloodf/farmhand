/**
 * Moonraker: an HTTP probe for discovery/diagnostics and a WebSocket
 * subscriber that keeps one printer's live state current.
 */
import type { PrinterLive } from "@farmhand/contracts";
import { z } from "zod";
import { fetchJson } from "./http.js";

const ServerInfo = z.object({
  result: z.object({
    klippy_state: z.string(),
    moonraker_version: z.string(),
    klippy_connected: z.boolean().optional(),
  }),
});
const PrinterInfo = z.object({
  result: z.object({ hostname: z.string().optional(), state: z.string().optional() }),
});

export interface MoonrakerIdentity {
  klippyState: string;
  moonrakerVersion: string;
  hostname: string | null;
}

export type ProbeResult = { ok: true; identity: MoonrakerIdentity } | { ok: false; error: string };

export const moonrakerHttp = (host: string, port: number) => `http://${host}:${port}`;
export const moonrakerWs = (host: string, port: number) => `ws://${host}:${port}/websocket`;

export async function probeMoonraker(host: string, port: number, timeoutMs = 2000): Promise<ProbeResult> {
  const base = moonrakerHttp(host, port);
  const info = await fetchJson(`${base}/server/info`, ServerInfo, { timeoutMs });
  if (!info.ok) return { ok: false, error: info.error };
  const printer = await fetchJson(`${base}/printer/info`, PrinterInfo, { timeoutMs });
  return {
    ok: true,
    identity: {
      klippyState: info.data.result.klippy_state,
      moonrakerVersion: info.data.result.moonraker_version,
      hostname: printer.ok ? (printer.data.result.hostname ?? null) : null,
    },
  };
}

// --- live subscriber

const SUBSCRIBE_OBJECTS = {
  print_stats: ["state", "filename", "print_duration", "message"],
  virtual_sdcard: ["progress"],
  display_status: ["message", "progress"],
  extruder: ["temperature", "target"],
  heater_bed: ["temperature", "target"],
  webhooks: ["state", "state_message"],
};

type Status = Record<string, Record<string, unknown>>;

export const STALE_AFTER_MS = 30_000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 30_000;
const MAX_FRAME_CHARS = 256_000;
const MAX_TEXT = 512;

export const emptyLive = (id: string): PrinterLive => ({
  id,
  connection: "connecting",
  state: null,
  filename: null,
  progress: null,
  printDurationS: null,
  message: null,
  temps: {},
  updatedAt: new Date().toISOString(),
  stale: false,
});

const JOB_STATES = new Set(["standby", "printing", "paused", "complete", "cancelled", "error"]);

export function applyStatus(prev: PrinterLive, status: Status): PrinterLive {
  const ps = status.print_stats ?? {};
  const sd = status.virtual_sdcard ?? {};
  const ds = status.display_status ?? {};
  const ex = status.extruder;
  const bed = status.heater_bed;
  const hooks = status.webhooks ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : undefined);
  const temp = (o: Record<string, unknown> | undefined, cur?: { actual: number; target: number }) => {
    if (!o) return cur;
    const actual = num(o.temperature) ?? cur?.actual;
    const target = num(o.target) ?? cur?.target;
    return actual === undefined ? cur : { actual, target: target ?? 0 };
  };
  const rawState = str(ps.state);
  const klippy = str(hooks.state);
  const connection: PrinterLive["connection"] =
    klippy === "startup"
      ? "klippy_startup"
      : klippy === "shutdown"
        ? "klippy_shutdown"
        : klippy === "error"
          ? "klippy_error"
          : "online";
  const progress = num(sd.progress) ?? num(ds.progress);
  return {
    ...prev,
    connection,
    state: rawState && JOB_STATES.has(rawState) ? (rawState as PrinterLive["state"]) : prev.state,
    filename: str(ps.filename) ?? prev.filename,
    progress: progress !== undefined ? Math.min(1, Math.max(0, progress)) : prev.progress,
    printDurationS: num(ps.print_duration) ?? prev.printDurationS,
    message: str(ds.message) ?? str(ps.message) ?? prev.message,
    temps: { extruder: temp(ex, prev.temps.extruder), bed: temp(bed, prev.temps.bed) },
    updatedAt: new Date().toISOString(),
    stale: false,
  };
}

export interface SubscriberHandle {
  stop(): void;
}

/** Keeps a WebSocket to one printer; `onUpdate` receives the full live object after each change. */
export function subscribe(
  id: string,
  host: string,
  port: number,
  onUpdate: (live: PrinterLive) => void,
  opts: { staleAfterMs?: number } = {},
): SubscriberHandle {
  let live = emptyLive(id);
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = BACKOFF_MIN;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let staleTimer: NodeJS.Timeout | undefined;
  let reqId = 0;
  const staleAfter = opts.staleAfterMs ?? STALE_AFTER_MS;

  const emit = (next: PrinterLive) => {
    live = next;
    onUpdate(live);
  };
  const armStale = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => emit({ ...live, stale: true }), staleAfter);
  };
  const offline = () =>
    emit({ ...live, connection: "offline", updatedAt: new Date().toISOString(), stale: false });

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(moonrakerWs(host, port));
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      backoff = BACKOFF_MIN;
      ws?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: ++reqId,
          method: "printer.objects.subscribe",
          params: { objects: SUBSCRIBE_OBJECTS },
        }),
      );
      armStale();
    };
    ws.onmessage = (e) => {
      const raw = String(e.data);
      if (raw.length > MAX_FRAME_CHARS) return; // a printer never sends frames this big; a rogue device might
      let msg: { method?: string; params?: unknown[]; result?: { status?: Status } };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      armStale();
      if (msg.result?.status) emit(applyStatus(live, msg.result.status));
      else if (msg.method === "notify_status_update" && Array.isArray(msg.params))
        emit(applyStatus(live, (msg.params[0] ?? {}) as Status));
      else if (msg.method === "notify_klippy_ready")
        emit({ ...live, connection: "online", updatedAt: new Date().toISOString() });
      else if (msg.method === "notify_klippy_shutdown")
        emit({ ...live, connection: "klippy_shutdown", updatedAt: new Date().toISOString() });
      else if (msg.method === "notify_klippy_disconnected")
        emit({ ...live, connection: "klippy_startup", updatedAt: new Date().toISOString() });
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      ws = null;
      if (staleTimer) clearTimeout(staleTimer);
      if (!stopped) {
        offline();
        scheduleReconnect();
      }
    };
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(BACKOFF_MAX, backoff * 2);
  };

  connect();
  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (staleTimer) clearTimeout(staleTimer);
      ws?.close();
    },
  };
}
