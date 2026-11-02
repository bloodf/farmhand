/** Services, logs and backup. All go through the root helper's fixed verbs. */
import { ConfirmSchema, LOG_SOURCES, SERVICE_IDS, SERVICE_LABELS } from "@farmhand/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Deps } from "../deps.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { type AppEnv, requireRole } from "../middleware/session.js";

const ServiceOut = z.object({
  id: z.enum(SERVICE_IDS),
  label: z.string(),
  state: z.enum(["running", "exited", "missing", "unknown"]),
  health: z.enum(["healthy", "unhealthy", "starting", "none"]),
});
const json = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const HelperErr = {
  description: "The helper refused or is unavailable",
  content: { "application/json": { schema: z.object({ code: z.string(), message: z.string() }) } },
};

// Second pass on top of the helper's own redaction; cheap insurance if the helper is older than the server.
const REDACT: [RegExp, string][] = [
  [/bearer\s+\S+/gi, "Bearer [redacted]"],
  [/(password|passwd|token|secret|api[_-]?key)(["']?\s*[:=]\s*["']?)\S+/gi, "$1$2[redacted]"],
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[jwt]"],
  [/:\/\/[^/\s:]+:[^@\s]+@/g, "://[redacted]@"],
];
export const redact = (line: string) => REDACT.reduce((l, [re, to]) => l.replace(re, to), line);

export const maintenanceRoutes = (deps: Deps) => {
  const actor = (c: {
    get: (k: "session") => { user: { id: string } } | null;
    req: { header: (n: string) => string | undefined };
  }) => ({
    id: c.get("session")?.user.id ?? "",
    ip: c.req.header("x-forwarded-for") ?? null,
  });

  return new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/services",
        tags: ["maintenance"],
        middleware: [requireRole("viewer")],
        responses: {
          200: json(
            z.object({ items: z.array(ServiceOut), guard: z.string(), helper: z.enum(["socket", "fake"]) }),
            "Compose state of the managed services",
          ),
          502: HelperErr,
        },
      }),
      async (c) => {
        const r = await deps.helper.status();
        if (!r.ok) return c.json({ code: r.code, message: r.message }, 502);
        const byId = new Map(r.services.map((s) => [s.service, s]));
        return c.json(
          {
            items: SERVICE_IDS.map((id) => ({
              id,
              label: SERVICE_LABELS[id],
              state: byId.get(id)?.state ?? "unknown",
              health: byId.get(id)?.health ?? "none",
            })),
            guard: r.guard,
            helper: deps.helper.kind,
          },
          200,
        );
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/services/{id}/restart",
        tags: ["maintenance"],
        middleware: [requireRole("operator"), rateLimit("restart", 3, 60_000)],
        request: {
          params: z.object({ id: z.enum(SERVICE_IDS) }),
          body: { content: { "application/json": { schema: ConfirmSchema } } },
        },
        responses: {
          200: json(
            z.object({
              operationId: z.string(),
              acceptedAt: z.string(),
              ready: z.boolean(),
              state: z.string(),
            }),
            "Restart accepted; `ready` says whether it came back healthy within 60 s",
          ),
          409: json(z.object({ code: z.literal("busy") }), "Another farm operation is running"),
          502: HelperErr,
        },
      }),
      async (c) => {
        const { id } = c.req.valid("param");
        const release = deps.lock.tryAcquire("restart");
        if (!release) return c.json({ code: "busy" as const }, 409);
        const opId = await deps.operations.open("restart", actor(c), id, { service: id });
        try {
          const r = await deps.helper.restart(id);
          if (!r.ok) {
            await deps.operations.update(opId, { status: r.code === "timeout" ? "unknown" : "failed" });
            return c.json({ code: r.code, message: r.message }, 502);
          }
          await deps.operations.update(opId, { status: r.ready ? "complete" : "partial" });
          return c.json({ operationId: opId, acceptedAt: r.acceptedAt, ready: r.ready, state: r.state }, 200);
        } finally {
          release();
        }
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/logs/{source}",
        tags: ["maintenance"],
        middleware: [requireRole("operator"), rateLimit("logs", 12, 60_000)],
        request: { params: z.object({ source: z.enum(LOG_SOURCES) }) },
        responses: {
          200: json(
            z.object({ source: z.enum(LOG_SOURCES), lines: z.array(z.string()), fetchedAt: z.string() }),
            "Last 100 lines, sanitized twice",
          ),
          502: HelperErr,
        },
      }),
      async (c) => {
        const { source } = c.req.valid("param");
        const r = await deps.helper.logs(source);
        if (!r.ok) return c.json({ code: r.code, message: r.message }, 502);
        return c.json(
          { source, lines: r.lines.slice(-100).map(redact), fetchedAt: new Date().toISOString() },
          200,
        );
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/backups",
        tags: ["maintenance"],
        middleware: [requireRole("admin"), rateLimit("backup", 1, 10 * 60_000)],
        request: { body: { content: { "application/json": { schema: ConfirmSchema } } } },
        responses: {
          202: json(
            z.object({ operationId: z.string(), acceptedAt: z.string() }),
            "Backup unit started; poll /backups/status",
          ),
          409: json(z.object({ code: z.literal("busy") }), "A backup or another farm operation is running"),
          502: HelperErr,
        },
      }),
      async (c) => {
        const release = deps.lock.tryAcquire("backup");
        if (!release) return c.json({ code: "busy" as const }, 409);
        try {
          const opId = await deps.operations.open("backup", actor(c), null, {});
          const r = await deps.helper.backupStart();
          if (!r.ok) {
            await deps.operations.update(opId, { status: "failed" });
            return r.code === "busy"
              ? c.json({ code: "busy" as const }, 409)
              : c.json({ code: r.code, message: r.message }, 502);
          }
          // The unit runs on its own; the status route and the UI follow it. Close the row as accepted.
          await deps.operations.update(opId, { status: "complete" });
          return c.json({ operationId: opId, acceptedAt: r.acceptedAt }, 202);
        } finally {
          release();
        }
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/backups/status",
        tags: ["maintenance"],
        middleware: [requireRole("viewer")],
        responses: {
          200: json(
            z.object({
              activeState: z.string(),
              result: z.string(),
              startedAt: z.string().nullable(),
              finishedAt: z.string().nullable(),
            }),
            "State of the backup unit",
          ),
          502: HelperErr,
        },
      }),
      async (c) => {
        const r = await deps.helper.backupStatus();
        if (!r.ok) return c.json({ code: r.code, message: r.message }, 502);
        return c.json(
          { activeState: r.activeState, result: r.result, startedAt: r.startedAt, finishedAt: r.finishedAt },
          200,
        );
      },
    );
};
