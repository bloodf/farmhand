/** Read-only fleet: overview, printers, apps, and the SSE stream. */
import {
  APP_IDS,
  AppHealthSchema,
  PrinterLiveSchema,
  SERVICE_LABELS,
  STEP_STATUSES,
} from "@farmhand/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { streamSSE } from "hono/streaming";
import { moonrakerHttp, moonrakerWs } from "../adapters/moonraker.js";
import { printers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { type AppEnv, requireRole } from "../middleware/session.js";

const IntegrationState = z.object({
  status: z.enum(STEP_STATUSES),
  message: z.string(),
  checkedAt: z.string(),
});
export const PrinterOut = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  source: z.enum(["discovery", "manual", "adopted"]),
  approvedAt: z.string().nullable(),
  integrations: z.object({
    allowlist: IntegrationState,
    printstash: IntegrationState,
    fdm: IntegrationState,
    mobileraker: IntegrationState,
  }),
  live: PrinterLiveSchema.nullable(),
});

const StockOut = z.object({
  source: z.enum(["ok", "unavailable"]),
  checkedAt: z.string(),
  error: z.string().nullable(),
  spools: z.number().nullable(),
  knownGrams: z.number().nullable(),
  spoolsWithoutWeight: z.number().nullable(),
  lowStock: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      material: z.string().nullable(),
      remainingGrams: z.number(),
    }),
  ),
  byMaterial: z.array(
    z.object({
      material: z.string().nullable(),
      spools: z.number(),
      knownGrams: z.number(),
      spoolsWithoutWeight: z.number(),
    }),
  ),
});

const OverviewOut = z.object({
  generatedAt: z.string(),
  printers: z.object({
    approved: z.number(),
    printing: z.number(),
    offline: z.number(),
    pending: z.number(),
  }),
  stock: StockOut,
  apps: z.array(AppHealthSchema),
});

const AppOut = z.object({
  id: z.enum(APP_IDS),
  label: z.string(),
  url: z.string().nullable(),
  health: AppHealthSchema.nullable(),
});
const SnippetsOut = z.object({
  moonrakerUrl: z.string(),
  websocketUrl: z.string(),
  lanIp: z.string().nullable(),
  spoolmanConf: z.string().nullable(),
});

const NotFound = {
  description: "No such printer",
  content: { "application/json": { schema: z.object({ code: z.literal("not_found") }) } },
};

export const fleetRoutes = (deps: Deps) => {
  const toOut = (row: typeof printers.$inferSelect) => ({
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    source: row.source,
    approvedAt: row.approvedAt,
    integrations: row.integrations,
    live: deps.live.printers.get(row.id) ?? null,
  });

  return new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/overview",
        tags: ["fleet"],
        middleware: [requireRole("viewer")],
        responses: {
          200: {
            description: "Fleet KPIs, stock and app health",
            content: { "application/json": { schema: OverviewOut } },
          },
        },
      }),
      async (c) => {
        const rows = await deps.db.select({ id: printers.id }).from(printers);
        const pending = await deps.candidates.pendingCount();
        let printing = 0;
        let offline = 0;
        for (const r of rows) {
          const live = deps.live.printers.get(r.id);
          if (!live || live.connection === "offline" || live.connection === "connecting") offline += 1;
          else if (live.state === "printing") printing += 1;
        }
        const s = deps.fleet.stock;
        const stock =
          s.source === "ok"
            ? { source: "ok" as const, checkedAt: s.checkedAt, error: null, ...s.data }
            : {
                source: "unavailable" as const,
                checkedAt: s.checkedAt,
                error: s.error,
                spools: null,
                knownGrams: null,
                spoolsWithoutWeight: null,
                lowStock: [],
                byMaterial: [],
              };
        return c.json(
          {
            generatedAt: new Date().toISOString(),
            printers: { approved: rows.length, printing, offline, pending },
            stock,
            apps: [...deps.live.apps.values()],
          },
          200,
        );
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/printers",
        tags: ["fleet"],
        middleware: [requireRole("viewer")],
        responses: {
          200: {
            description: "Registered printers with live state",
            content: { "application/json": { schema: z.object({ items: z.array(PrinterOut) }) } },
          },
        },
      }),
      async (c) =>
        c.json({ items: (await deps.db.select().from(printers).orderBy(printers.name)).map(toOut) }, 200),
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/printers/{id}",
        tags: ["fleet"],
        middleware: [requireRole("viewer")],
        request: { params: z.object({ id: z.string() }) },
        responses: {
          200: { description: "One printer", content: { "application/json": { schema: PrinterOut } } },
          404: NotFound,
        },
      }),
      async (c) => {
        const row = await deps.db.query.printers.findFirst({
          where: eq(printers.id, c.req.valid("param").id),
        });
        return row ? c.json(toOut(row), 200) : c.json({ code: "not_found" as const }, 404);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/printers/{id}/snippets",
        tags: ["fleet"],
        middleware: [requireRole("viewer")],
        request: { params: z.object({ id: z.string() }) },
        responses: {
          200: {
            description: "Copy-paste configuration for this printer",
            content: { "application/json": { schema: SnippetsOut } },
          },
          404: NotFound,
        },
      }),
      async (c) => {
        const row = await deps.db.query.printers.findFirst({
          where: eq(printers.id, c.req.valid("param").id),
        });
        if (!row) return c.json({ code: "not_found" as const }, 404);
        const lanIp = deps.env.FARMHAND_LAN_IP || null;
        return c.json(
          {
            moonrakerUrl: moonrakerHttp(row.host, row.port),
            websocketUrl: moonrakerWs(row.host, row.port),
            lanIp,
            spoolmanConf: lanIp ? `[spoolman]\nserver: http://${lanIp}:7912\nsync_rate: 5\n` : null,
          },
          200,
        );
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/apps",
        tags: ["fleet"],
        middleware: [requireRole("viewer")],
        responses: {
          200: {
            description: "Launchers with health",
            content: { "application/json": { schema: z.object({ items: z.array(AppOut) }) } },
          },
        },
      }),
      (c) => {
        const e = deps.env;
        const urls: Record<(typeof APP_IDS)[number], string> = {
          printstash: e.PRINTSTASH_PUBLIC_URL,
          spoolman: e.SPOOLMAN_PUBLIC_URL,
          "fdm-monster": e.FDM_PUBLIC_URL,
          orcaslicer: e.ORCASLICER_PUBLIC_URL,
        };
        return c.json(
          {
            items: APP_IDS.map((id) => ({
              id,
              label: SERVICE_LABELS[id],
              url: urls[id] || null,
              health: deps.live.apps.get(id) ?? null,
            })),
          },
          200,
        );
      },
    )
    .get("/events", requireRole("viewer"), (c) =>
      streamSSE(c, async (stream) => {
        let n = 0;
        let writing: Promise<void> = Promise.resolve();
        let dropped = 0;
        const done = Promise.withResolvers<void>();
        // Serialize writes; when the reader cannot keep up, drop frames rather than queue without bound.
        const send = (data: string, event = "farm") => {
          if (stream.aborted) return;
          if (dropped > 0 || writing !== settled) {
            dropped += 1;
            return;
          }
          writing = stream.writeSSE({ data, event, id: String(n++) }).then(() => {
            writing = settled;
            if (dropped > 0) {
              dropped = 0;
              send(JSON.stringify(deps.live.snapshot()));
            }
          });
        };
        const settled = writing;
        const unsubscribe = deps.live.subscribe((e) => send(JSON.stringify(e)));
        const ping = setInterval(() => {
          // A ban or role change must close an open stream, not wait for the next page load.
          void deps.auth.api.getSession({ headers: c.req.raw.headers }).then((s) => {
            if (!deps.env.FARMHAND_OPEN_ACCESS && (!s || s.user.banned)) return cleanup();
            if (!stream.aborted && writing === settled) void stream.write(": ping\n\n");
          });
        }, 15_000);
        const cleanup = () => {
          unsubscribe();
          clearInterval(ping);
          done.resolve();
        };
        stream.onAbort(cleanup);
        if (stream.aborted) cleanup();
        else send(JSON.stringify(deps.live.snapshot()));
        await done.promise;
      }),
    );
};
