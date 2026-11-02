import { ROLES, type Role } from "@farmhand/contracts";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin as adminPlugin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { count } from "drizzle-orm";
import type { Db } from "./db/client.js";
import * as schema from "./db/schema.js";
import type { Env } from "./env.js";

const statement = { ...defaultStatements, farm: ["read", "operate", "admin"] } as const;
export const ac = createAccessControl(statement);
export const roles = {
  viewer: ac.newRole({ farm: ["read"] }),
  operator: ac.newRole({ farm: ["read", "operate"] }),
  admin: ac.newRole({ farm: ["read", "operate", "admin"], ...adminAc.statements }),
};

/** viewer < operator < admin */
export const roleAtLeast = (have: string | null | undefined, need: Role): boolean =>
  ROLES.indexOf((have ?? "viewer") as Role) >= ROLES.indexOf(need);

export function createAuth(db: Db, env: Env) {
  const countUsers = async () => (await db.select({ n: count() }).from(schema.user))[0]?.n ?? 0;
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.FARMHAND_PUBLIC_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.FARMHAND_PUBLIC_URL],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: true },
    user: { additionalFields: { locale: { type: "string", defaultValue: "en-US", input: true } } },
    session: { cookieCache: { enabled: true, maxAge: 60 } },
    advanced: {
      useSecureCookies: env.FARMHAND_PUBLIC_URL.startsWith("https://"),
      // Only a header the reverse proxy overwrites may identify the client; X-Forwarded-For can be forged.
      ipAddress: { ipAddressHeaders: [env.FARMHAND_TRUSTED_IP_HEADER] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 5 } },
    },
    databaseHooks: {
      user: {
        create: {
          // Public sign-up only creates the very first account, which becomes admin.
          // Every later account comes from an admin through the admin plugin.
          before: async (data, ctx) => {
            const existing = await countUsers();
            if (ctx?.path === "/sign-up/email") {
              if (existing > 0) throw new APIError("FORBIDDEN", { message: "setup_complete" });
              return { data: { ...data, role: "admin" } };
            }
            return { data: { ...data, role: (data as { role?: string }).role ?? "viewer" } };
          },
        },
      },
    },
    plugins: [adminPlugin({ ac, roles, defaultRole: "viewer", adminRoles: ["admin"] })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
