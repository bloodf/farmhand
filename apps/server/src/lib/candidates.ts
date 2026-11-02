import { and, count, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { candidates, printers } from "../db/schema.js";

export class Candidates {
  constructor(private readonly db: Db) {}

  private get notApproved() {
    return notInArray(
      sql`${candidates.host} || ':' || ${candidates.port}`,
      this.db.select({ k: sql<string>`${printers.host} || ':' || ${printers.port}` }).from(printers),
    );
  }

  async pendingCount(): Promise<number> {
    const r = await this.db
      .select({ n: count() })
      .from(candidates)
      .where(and(isNull(candidates.dismissedAt), this.notApproved));
    return r[0]?.n ?? 0;
  }

  pending() {
    return this.db
      .select()
      .from(candidates)
      .where(and(isNull(candidates.dismissedAt), this.notApproved))
      .orderBy(candidates.lastSeenAt);
  }
}
