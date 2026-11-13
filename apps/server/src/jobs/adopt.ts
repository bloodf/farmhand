/** Empty registry at boot: import the Moonraker printers PrintStash already knows, so an existing farm is not blank. */
import { randomUUID } from "node:crypto";
import { checkTarget, isValidPort, nameProblem } from "@farmhand/contracts";
import { count } from "drizzle-orm";
import type { PrintStash } from "../adapters/printstash.js";
import type { Db } from "../db/client.js";
import { type Integrations, printers } from "../db/schema.js";
import type { Log } from "../deps.js";

export const unknownIntegrations = (): Integrations => {
  const s = { status: "unknown" as const, message: "not_checked", checkedAt: new Date(0).toISOString() };
  return { allowlist: s, printstash: s, fdm: s, mobileraker: s };
};

export async function adoptFromPrintStash(
  db: Db,
  printstash: PrintStash,
  log: Log,
  opts: { lanIfaces: readonly string[]; allowLoopback: boolean; bridgeTargets: readonly string[] },
): Promise<number> {
  const { lanIfaces, allowLoopback, bridgeTargets } = opts;
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
    // PrintStash data is not trusted: only plain LAN IPv4 targets with a sane name are adopted.
    const port = Number(u.port || 7125);
    const target = checkTarget(u.hostname, { lan: true, lanIfaces, allowLoopback, port, bridgeTargets });
    if (!target.ok || !isValidPort(port) || nameProblem(name)) {
      log.warn(
        { host: u.hostname.slice(0, 80), reason: target.ok ? "name_or_port" : target.code },
        "adopt: skipped",
      );
      continue;
    }
    const now = new Date().toISOString();
    const integrations = unknownIntegrations();
    integrations.printstash = { status: "already_configured", message: "adopted", checkedAt: now };
    await db
      .insert(printers)
      .values({
        id: randomUUID(),
        name,
        host: u.hostname,
        port,
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
