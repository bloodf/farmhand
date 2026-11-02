import type { SettingsPatch } from "@farmhand/contracts";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { settings } from "../db/schema.js";

export interface Settings {
  discoveryIntervalMin: number;
  lanIfaces: string[];
  lowStockGrams: number;
}

export const DEFAULT_SETTINGS: Settings = {
  discoveryIntervalMin: 15,
  lanIfaces: ["br0"],
  lowStockGrams: 200,
};

export class SettingsStore {
  private readonly listeners: ((s: Settings) => void)[] = [];
  onChange(fn: (s: Settings) => void) {
    this.listeners.push(fn);
  }

  constructor(
    private readonly db: Db,
    private readonly defaults: Settings = DEFAULT_SETTINGS,
  ) {}

  async read(): Promise<Settings> {
    const rows = await this.db.select().from(settings);
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...this.defaults, ...stored } as Settings;
  }

  async write(patch: SettingsPatch, by: string | null): Promise<Settings> {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await this.db
        .insert(settings)
        .values({ key, value, updatedAt: now, updatedBy: by })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: sql`excluded.value`, updatedAt: now, updatedBy: by },
        });
    }
    const next = await this.read();
    for (const l of this.listeners) l(next);
    return next;
  }
}
