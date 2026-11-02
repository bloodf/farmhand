/** First run: no users yet → anyone can create the single admin. After that, 410. */
import { SetupSchema } from "@farmhand/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { APIError } from "better-auth/api";
import { count } from "drizzle-orm";
import { user } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type { AppEnv } from "../middleware/session.js";

export const setupRoutes = (deps: Deps) => {
  const usersExist = async () => ((await deps.db.select({ n: count() }).from(user))[0]?.n ?? 0) > 0;
  const Status = z.object({ needsSetup: z.boolean() });

  return new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/setup/status",
        tags: ["setup"],
        responses: {
          200: {
            description: "Whether the first admin still has to be created",
            content: { "application/json": { schema: Status } },
          },
        },
      }),
      async (c) => c.json({ needsSetup: !(await usersExist()) }, 200),
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/setup",
        tags: ["setup"],
        middleware: [rateLimit("setup", 5, 60_000)],
        request: { body: { content: { "application/json": { schema: SetupSchema } } } },
        responses: {
          201: {
            description: "Admin created and signed in",
            content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
          },
          410: {
            description: "Setup already done",
            content: { "application/json": { schema: z.object({ code: z.literal("setup_complete") }) } },
          },
        },
      }),
      async (c) => {
        if (await usersExist()) return c.json({ code: "setup_complete" as const }, 410);
        const body = c.req.valid("json");
        try {
          // The user.create.before hook re-checks the count and promotes the first account to admin.
          const res = await deps.auth.api.signUpEmail({
            body: { name: body.name, email: body.email, password: body.password, locale: body.locale },
            headers: c.req.raw.headers,
            returnHeaders: true,
          });
          for (const cookie of res.headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
        } catch (err) {
          if (err instanceof APIError && err.message.includes("setup_complete"))
            return c.json({ code: "setup_complete" as const }, 410);
          throw err;
        }
        await deps.operations.open("user", null, body.email, { event: "setup" });
        return c.json({ ok: true as const }, 201);
      },
    );
};
