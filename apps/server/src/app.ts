import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import type { Deps } from "./deps.js";
import { sameOrigin } from "./middleware/same-origin.js";
import { type AppEnv, requireRole, sessionMiddleware } from "./middleware/session.js";
import { fleetRoutes } from "./routes/fleet.js";
import { healthRoutes } from "./routes/health.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { operationsRoutes } from "./routes/operations.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";

export function createApp(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ code: "validation", issues: result.error.issues }, 400);
    },
  });

  app.use("*", requestId());
  app.use("*", secureHeaders({ referrerPolicy: "same-origin" }));
  app.use("/api/*", sameOrigin(deps.env.FARMHAND_PUBLIC_URL));
  app.use("/api/*", sessionMiddleware(deps.auth));

  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  const api = new OpenAPIHono<AppEnv>()
    .route("/", healthRoutes(deps))
    .route("/", setupRoutes(deps))
    .route("/", settingsRoutes(deps))
    .route("/", operationsRoutes(deps))
    .route("/", fleetRoutes(deps))
    .route("/", onboardingRoutes(deps));

  app.route("/api", api);

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: { title: "farmhand", version: deps.version },
    servers: [{ url: "/" }],
  });
  app.get("/api/docs", requireRole("viewer"), Scalar({ url: "/api/openapi.json", theme: "default" }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ code: err.message || "error" }, err.status);
    if (err instanceof ZodError) return c.json({ code: "validation", issues: err.issues }, 400);
    deps.log.error({ err, requestId: c.get("requestId") }, "unhandled");
    return c.json({ code: "internal" }, 500);
  });
  app.notFound((c) =>
    c.req.path.startsWith("/api/") ? c.json({ code: "not_found" }, 404) : c.text("", 404),
  );

  if (deps.env.FARMHAND_WEB_DIST) {
    const root = deps.env.FARMHAND_WEB_DIST;
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({ root, path: "index.html" }));
  }

  return { app, api };
}

export type App = ReturnType<typeof createApp>["app"];
export type ApiType = ReturnType<typeof createApp>["api"];
