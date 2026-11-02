import type { Role } from "@farmhand/contracts";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type Auth, roleAtLeast, type Session } from "../auth.js";

export type AppEnv = {
  Variables: {
    session: Session | null;
    requestId: string;
  };
};

export const sessionMiddleware = (auth: Auth) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set("session", await auth.api.getSession({ headers: c.req.raw.headers }));
    await next();
  });

/** Fails closed: no session is 401, a lower role is 403. */
export const requireRole = (need: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const s = c.get("session");
    if (!s) throw new HTTPException(401, { message: "unauthenticated" });
    if (s.user.banned) throw new HTTPException(403, { message: "banned" });
    if (!roleAtLeast(s.user.role, need)) throw new HTTPException(403, { message: "forbidden" });
    await next();
  });
