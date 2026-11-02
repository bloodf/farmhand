/**
 * Finds Moonraker printers on the LAN and records them as candidates. Never
 * registers anything. Sources: mDNS (_moonraker._tcp via avahi-browse) and the
 * host's IPv4 neighbour table on the configured interfaces, probed on 7125.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkTarget, DEFAULT_MOONRAKER_PORT, type Ipv4Net, parseIpv4 } from "@farmhand/contracts";
import { sql } from "drizzle-orm";
import { probeMoonraker } from "../adapters/moonraker.js";
import type { Db } from "../db/client.js";
import { candidates } from "../db/schema.js";
import type { Log } from "../deps.js";
import type { Env } from "../env.js";
import type { SettingsStore } from "../lib/settings.js";
import type { LiveStore } from "../live/store.js";

const run = promisify(execFile);
const PROBE_CONCURRENCY = 64;
const PROBE_TIMEOUT_MS = 2000;

export type Target = { host: string; port: number; source: "mdns" | "neigh" | "manual" };

export async function mdnsTargets(): Promise<Target[]> {
  try {
    const { stdout } = await run("avahi-browse", ["-rtpk", "_moonraker._tcp"], { timeout: 15_000 });
    const out: Target[] = [];
    for (const line of stdout.split("\n")) {
      const f = line.split(";");
      if (f[0] !== "=" || f[2] !== "IPv4" || !f[7] || !f[8]) continue;
      const port = Number(f[8]);
      if (parseIpv4(f[7]) && Number.isInteger(port) && port > 0 && port < 65536)
        out.push({ host: f[7], port, source: "mdns" });
    }
    return out;
  } catch {
    return []; // avahi missing or no daemon: not an error, just one source fewer
  }
}

export async function neighbourTargets(ifaces: readonly string[]): Promise<Target[]> {
  const out: Target[] = [];
  for (const iface of ifaces) {
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(iface)) continue;
    try {
      const { stdout } = await run("ip", ["-j", "-4", "neigh", "show", "dev", iface], { timeout: 5000 });
      const rows = JSON.parse(stdout) as { dst?: string; state?: string[] }[];
      for (const r of rows) {
        if (!r.dst || !parseIpv4(r.dst)) continue;
        if (r.state?.some((s) => s === "FAILED" || s === "INCOMPLETE")) continue;
        out.push({ host: r.dst, port: DEFAULT_MOONRAKER_PORT, source: "neigh" });
      }
    } catch {
      /* interface without neighbours or no `ip`: skip */
    }
  }
  return out;
}

export interface DiscoveryDeps {
  env: Env;
  db: Db;
  live: LiveStore;
  settings: SettingsStore;
  log: Log;
  /** Test seams. */
  sources?: (ifaces: readonly string[]) => Promise<Target[]>;
  nets?: readonly Ipv4Net[];
}

export class Discovery {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly d: DiscoveryDeps) {}

  get isRunning() {
    return this.running !== null;
  }

  start() {
    const tick = async () => {
      const { discoveryIntervalMin } = await this.d.settings.read();
      const r = this.run({ notify: true });
      if (!("busy" in r)) await r.catch(() => undefined);
      this.timer = setTimeout(tick, discoveryIntervalMin * 60_000);
    };
    this.timer = setTimeout(tick, 5000);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Single flight: a second call while one runs gets `busy`. */
  run(opts: { notify: boolean }): Promise<void> | { busy: true } {
    if (this.running) return { busy: true };
    this.running = this.execute(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(opts: { notify: boolean }) {
    this.d.live.setDiscovery({ ...this.d.live.discovery, running: true });
    let error: string | null = null;
    try {
      const { lanIfaces } = await this.d.settings.read();
      const sources =
        this.d.sources ?? (async (ifs) => [...(await mdnsTargets()), ...(await neighbourTargets(ifs))]);
      const targets = dedupe(await sources(lanIfaces)).filter(
        (t) =>
          checkTarget(t.host, {
            lan: true,
            lanIfaces,
            allowLoopback: this.d.env.FARMHAND_DEV_ALLOW_LOOPBACK,
            nets: this.d.nets,
          }).ok,
      );
      const found = await mapLimit(targets, PROBE_CONCURRENCY, async (t) => {
        const r = await probeMoonraker(t.host, t.port, PROBE_TIMEOUT_MS);
        return r.ok ? { ...t, ...r.identity } : null;
      });
      const printers = found.filter((f): f is NonNullable<typeof f> => f !== null);
      const fresh = await this.record(printers);
      if (opts.notify) await this.notify(fresh);
      this.d.log.info(
        { candidates: targets.length, found: printers.length, fresh: fresh.length },
        "discovery run",
      );
    } catch (err) {
      error = (err as Error).name || "failed";
      this.d.log.warn({ err }, "discovery failed");
    }
    this.d.live.setDiscovery({ running: false, lastRunAt: new Date().toISOString(), lastError: error });
    this.d.live.emit({ type: "candidates", changedAt: new Date().toISOString() });
  }

  /** Upserts; returns the printers seen for the first time. */
  async record(
    printers: (Target & { hostname: string | null; klippyState: string; moonrakerVersion: string })[],
  ) {
    const now = new Date().toISOString();
    const fresh: typeof printers = [];
    for (const p of printers) {
      const res = await this.d.db
        .insert(candidates)
        .values({
          host: p.host,
          port: p.port,
          name: p.hostname,
          klippyState: p.klippyState,
          moonrakerVersion: p.moonrakerVersion,
          source: p.source,
          firstSeenAt: now,
          lastSeenAt: now,
          dismissedAt: null,
        })
        .onConflictDoUpdate({
          target: [candidates.host, candidates.port],
          set: {
            name: p.hostname,
            klippyState: p.klippyState,
            moonrakerVersion: p.moonrakerVersion,
            lastSeenAt: now,
          },
        })
        .returning({ firstSeenAt: candidates.firstSeenAt });
      if (res[0]?.firstSeenAt === now) fresh.push(p);
    }
    if (printers.length) this.d.live.emit({ type: "candidates", changedAt: now });
    return fresh;
  }

  private async notify(fresh: Target[]) {
    const { HA_URL, HA_DISCOVERY_WEBHOOK } = this.d.env;
    if (!HA_URL || !HA_DISCOVERY_WEBHOOK || fresh.length === 0) return;
    for (const p of fresh) {
      try {
        await fetch(`${HA_URL}/api/webhook/${encodeURIComponent(HA_DISCOVERY_WEBHOOK)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ host: p.host, port: p.port }),
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
      } catch (err) {
        this.d.log.warn({ err: (err as Error).name }, "discovery notify failed");
      }
    }
  }
}

function dedupe(ts: Target[]): Target[] {
  const seen = new Map<string, Target>();
  for (const t of ts) if (!seen.has(`${t.host}:${t.port}`)) seen.set(`${t.host}:${t.port}`, t);
  return [...seen.values()].sort((a, b) => a.host.localeCompare(b.host));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const candidateKey = sql`${candidates.host} || ':' || ${candidates.port}`;
