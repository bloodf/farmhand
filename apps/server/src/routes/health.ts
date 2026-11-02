import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Deps } from "../deps.js";
import type { AppEnv } from "../middleware/session.js";

export const healthRoutes = (deps: Deps) =>
  new OpenAPIHono<AppEnv>().openapi(
    createRoute({
      method: "get",
      path: "/health",
      tags: ["system"],
      responses: {
        200: {
          description: "Process is up",
          content: { "application/json": { schema: z.object({ ok: z.literal(true), version: z.string() }) } },
        },
      },
    }),
    (c) => c.json({ ok: true as const, version: deps.version }, 200),
  );
