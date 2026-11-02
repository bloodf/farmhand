/** Empty registry at boot: import the Moonraker printers PrintStash already knows, so an existing farm is not blank. */
import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import type { PrintStash } from "../adapters/printstash.js";
import type { Db } from "../db/client.js";
import { type Integrations, printers } from "../db/schema.js";
import type { Log } from "../deps.js";

export const unknownIntegrations = (): Integrations => {
  const s = { status: "unknown" as const, message: "not_checked", checkedAt: new Date(0).toISOString() };
  return { allowlist: s, printstash: s, fdm: s, mobileraker: s };
};

export async function adoptFromPrintStash(db: Db, printstash: PrintStash, log: Log): Promise<number> {
  const existing = (await db.select({ n: count() }).from(printers))[0]?.n ?? 0;
  if (existing > 0 || !printstash.configured) return 0;
  const reg = await printstash.registered();
  if (!reg.ok) {
    log.warn({ error: reg.error }, "adopt: printstash unavailable");
    return 0;
  }
  let adopted = 0;
  for (const [url, name] of reg.urls) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" || !u.hostname) continue;
    const now = new Date().toISOString();
    const integrations = unknownIntegrations();
    integrations.printstash = { status: "already_configured", message: "adopted", checkedAt: now };
    await db
      .insert(printers)
      .values({
        id: randomUUID(),
        name,
        host: u.hostname,
        port: Number(u.port || 7125),
        source: "adopted",
        approvedAt: now,
        approvedBy: null,
        integrations,
        lastSnapshot: null,
        updatedAt: now,
      })
      .onConflictDoNothing();
    adopted += 1;
  }
  if (adopted) log.info({ adopted }, "adopt: imported printers from PrintStash");
  return adopted;
}
