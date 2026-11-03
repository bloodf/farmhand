/**
 * Background jobs: one Moonraker subscriber per registered printer, app
 * health every 15 s, Spoolman stock cached for the overview. Reconciles
 * subscribers with the printers table on demand.
 */
import type { AppHealth, ServiceId } from "@farmhand/contracts";
import { z } from "zod";
import type { FdmMonster } from "../adapters/fdm-monster.js";
import { fetchJson } from "../adapters/http.js";
import { type SubscriberHandle, subscribe } from "../adapters/moonraker.js";
import type { PrintStash } from "../adapters/printstash.js";
import type { Spoolman, StockSummary } from "../adapters/spoolman.js";
import type { Db } from "../db/client.js";
import { printers } from "../db/schema.js";
import type { Env } from "../env.js";
import type { SettingsStore } from "../lib/settings.js";
import type { LiveStore } from "../live/store.js";

export const APP_HEALTH_INTERVAL_MS = 15_000;
export const STOCK_INTERVAL_MS = 60_000;

export type Stock =
  | { source: "ok"; checkedAt: string; error: null; data: StockSummary }
  | { source: "unavailable"; checkedAt: string; error: string; data: null };

export interface FleetDeps {
  env: Env;
  db: Db;
  live: LiveStore;
  settings: SettingsStore;
  printstash: PrintStash;
  fdm: FdmMonster;
  spoolman: Spoolman;
}

export class Fleet {
  private readonly subs = new Map<string, SubscriberHandle>();
  private timers: NodeJS.Timeout[] = [];
  stock: Stock = {
    source: "unavailable",
    checkedAt: new Date(0).toISOString(),
    error: "not_checked",
    data: null,
  };

  constructor(private readonly d: FleetDeps) {}

  async start() {
    await this.reconcileSubscribers();
    await Promise.all([this.checkApps(), this.refreshStock()]);
    this.timers.push(setInterval(() => void this.checkApps(), APP_HEALTH_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.refreshStock(), STOCK_INTERVAL_MS));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.subs.values()) s.stop();
    this.subs.clear();
  }

  /** Start subscribers for new printers, stop them for removed ones. Call after any printers change. */
  async reconcileSubscribers() {
    const rows = await this.d.db
      .select({ id: printers.id, host: printers.host, port: printers.port })
      .from(printers);
    const wanted = new Map(rows.map((r) => [r.id, r]));
    for (const [id, sub] of this.subs) {
      if (!wanted.has(id)) {
        sub.stop();
        this.subs.delete(id);
        this.d.live.removePrinter(id);
      }
    }
    for (const [id, r] of wanted) {
      if (this.subs.has(id)) continue;
      this.subs.set(
        id,
        subscribe(id, r.host, r.port, (live) => this.d.live.setPrinter(live)),
      );
    }
  }

  async checkApps() {
    const e = this.d.env;
    const checks: [ServiceId, () => Promise<{ ok: boolean; error?: string; latencyMs: number }>][] = [
      ["spoolman", () => this.d.spoolman.health()],
      ["printstash", () => this.d.printstash.health()],
      ["fdm-monster", () => this.d.fdm.health()],
      ["orcaslicer", () => fetchJson(`${e.ORCASLICER_URL}/`, z.unknown(), { headers: { accept: "*/*" } })],
      ["mainsail", () => fetchJson(`${e.MAINSAIL_URL}/`, z.unknown(), { headers: { accept: "*/*" } })],
    ];
    await Promise.all(
      checks.map(async ([id, fn]) => {
        const r = await fn();
        const health: AppHealth = {
          id,
          status: r.ok ? "up" : "down",
          checkedAt: new Date().toISOString(),
          latencyMs: r.latencyMs,
          error: r.ok ? null : (r.error ?? "unknown"),
        };
        // OrcaSlicer and Mainsail answer with HTML (OrcaSlicer may add basic auth); either means the service is up.
        if (
          (id === "orcaslicer" || id === "mainsail") &&
          !r.ok &&
          (r.error === "http_401" || r.error === "not_json")
        ) {
          health.status = "up";
          health.error = null;
        }
        this.d.live.setApp(health);
      }),
    );
  }

  async refreshStock() {
    const { lowStockGrams } = await this.d.settings.read();
    const r = await this.d.spoolman.stock(lowStockGrams);
    const checkedAt = new Date().toISOString();
    this.stock = r.ok
      ? { source: "ok", checkedAt, error: null, data: r.data }
      : { source: "unavailable", checkedAt, error: r.error, data: null };
  }
}
