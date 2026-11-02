import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./session.js";

// ponytail: fixed window in a Map; single process only, which is all farmhand runs as.
const buckets = new Map<string, { until: number; n: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const who = c.get("session")?.user.id ?? c.req.header("x-forwarded-for") ?? "anon";
    const k = `${key}:${who}`;
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || b.until <= now) buckets.set(k, { until: now + windowMs, n: 1 });
    else if (b.n >= max) throw new HTTPException(429, { message: "rate_limited" });
    else b.n += 1;
    if (buckets.size > 10_000) for (const [bk, bv] of buckets) if (bv.until <= now) buckets.delete(bk);
    await next();
  });
}

export const resetRateLimitsForTests = () => buckets.clear();
