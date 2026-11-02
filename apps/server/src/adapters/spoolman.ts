/** Spoolman 0.27.x: health and a stock summary. Unknown weights stay unknown, never zero. */
import { z } from "zod";
import { fetchJson } from "./http.js";

const Spool = z.object({
  id: z.number(),
  archived: z.boolean().optional(),
  remaining_weight: z.number().nullable().optional(),
  filament: z.object({
    name: z.string().optional(),
    material: z.string().nullable().optional(),
    vendor: z.object({ name: z.string() }).nullable().optional(),
  }),
});
const Health = z.object({ status: z.string() });

export interface StockSummary {
  spools: number;
  knownGrams: number;
  spoolsWithoutWeight: number;
  lowStock: { id: number; name: string; material: string | null; remainingGrams: number }[];
  byMaterial: { material: string | null; spools: number; knownGrams: number; spoolsWithoutWeight: number }[];
}

export class Spoolman {
  constructor(private readonly url: string) {}

  health() {
    return fetchJson(`${this.url}/api/v1/health`, Health);
  }

  async stock(
    lowStockGrams: number,
  ): Promise<{ ok: true; data: StockSummary } | { ok: false; error: string }> {
    const res = await fetchJson(`${this.url}/api/v1/spool?allow_archived=false`, z.array(Spool));
    if (!res.ok) return { ok: false, error: res.error };
    const active = res.data.filter((s) => !s.archived);
    const byMat = new Map<
      string | null,
      { spools: number; knownGrams: number; spoolsWithoutWeight: number }
    >();
    let knownGrams = 0;
    let spoolsWithoutWeight = 0;
    const lowStock: StockSummary["lowStock"] = [];
    for (const s of active) {
      const material = s.filament.material ?? null;
      const m = byMat.get(material) ?? { spools: 0, knownGrams: 0, spoolsWithoutWeight: 0 };
      m.spools += 1;
      const w = s.remaining_weight;
      if (typeof w === "number") {
        m.knownGrams += w;
        knownGrams += w;
        if (w <= lowStockGrams) {
          const vendor = s.filament.vendor?.name;
          lowStock.push({
            id: s.id,
            name: [vendor, s.filament.name].filter(Boolean).join(" "),
            material,
            remainingGrams: w,
          });
        }
      } else {
        m.spoolsWithoutWeight += 1;
        spoolsWithoutWeight += 1;
      }
      byMat.set(material, m);
    }
    return {
      ok: true,
      data: {
        spools: active.length,
        knownGrams: Math.round(knownGrams),
        spoolsWithoutWeight,
        lowStock: lowStock.sort((a, b) => a.remainingGrams - b.remainingGrams),
        byMaterial: [...byMat]
          .map(([material, m]) => ({ material, ...m, knownGrams: Math.round(m.knownGrams) }))
          .sort((a, b) => b.spools - a.spools),
      },
    };
  }
}
