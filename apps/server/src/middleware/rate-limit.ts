import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { clientIp } from "../lib/client-ip.js";
import type { AppEnv } from "./session.js";

// ponytail: fixed window in a Map; single process only, which is all farmhand runs as.
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, { until: number; n: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const who = (
      c.get("session")?.user.id ??
      clientIp((n) => c.req.header(n), c.get("trustedIpHeader")) ??
      "anon"
    ).slice(0, 45);
    const k = `${key}:${who}`;
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || b.until <= now) buckets.set(k, { until: now + windowMs, n: 1 });
    else if (b.n >= max) throw new HTTPException(429, { message: "rate_limited" });
    else b.n += 1;
    if (buckets.size > MAX_BUCKETS) {
      for (const [bk, bv] of buckets) if (bv.until <= now) buckets.delete(bk);
      if (buckets.size > MAX_BUCKETS) throw new HTTPException(429, { message: "rate_limited" });
    }
    await next();
  });
}

export const resetRateLimitsForTests = () => buckets.clear();
