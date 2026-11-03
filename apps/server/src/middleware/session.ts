import type { Role } from "@farmhand/contracts";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type Auth, roleAtLeast, type Session } from "../auth.js";

export type AppEnv = {
  Variables: {
    session: Session | null;
    requestId: string;
    trustedIpHeader: string;
  };
};

/** The admin every request runs as when FARMHAND_OPEN_ACCESS is on. Never stored. */
export const openSession = (): Session => {
  const now = new Date();
  return {
    session: {
      id: "open",
      token: "",
      userId: "open",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
    user: {
      id: "open",
      name: "Local",
      email: "",
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
      role: "admin",
      banned: false,
      banReason: null,
      banExpires: null,
      locale: "en-US",
    },
  };
};

export const sessionMiddleware = (auth: Auth, open = false) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("session", s ?? (open ? openSession() : null));
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
