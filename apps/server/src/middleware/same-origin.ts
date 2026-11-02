/**
 * Writes must come from our own origin. hono/csrf only inspects form posts;
 * JSON bodies need this explicit check. Browsers always send Origin on
 * cross-site POST/PATCH/DELETE, so a missing header is treated as foreign.
 */
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const sameOrigin = (publicUrl: string) => {
  const allowed = new URL(publicUrl).origin;
  return createMiddleware(async (c, next) => {
    if (!SAFE.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== allowed && c.req.header("sec-fetch-site") !== "same-origin") {
        throw new HTTPException(403, { message: "csrf" });
      }
    }
    await next();
  });
};
