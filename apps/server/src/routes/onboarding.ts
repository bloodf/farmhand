/** Candidates, discovery, approval, diagnostics and repair. Every write is operator+, same-origin, rate limited. */
import {
  ApprovalPreviewSchema,
  ConfirmTokenSchema,
  checkTarget,
  nameProblem,
  STEP_IDS,
  StepSchema,
  TargetSchema,
} from "@farmhand/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { moonrakerHttp, probeMoonraker } from "../adapters/moonraker.js";
import { candidates, printers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { clientIp } from "../lib/client-ip.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { type AppEnv, requireRole } from "../middleware/session.js";

const CandidateOut = z.object({
  host: z.string(),
  port: z.number(),
  name: z.string().nullable(),
  klippyState: z.string().nullable(),
  moonrakerVersion: z.string().nullable(),
  source: z.enum(["mdns", "neigh", "manual"]),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
const Identity = z.object({
  klippyState: z.string(),
  moonrakerVersion: z.string(),
  hostname: z.string().nullable(),
});
const Effect = z.object({
  id: z.enum(STEP_IDS),
  willDo: z.enum(["add", "already", "unknown"]),
  detail: z.string(),
});
const Err = (code: string, extra: z.ZodRawShape = {}) => ({
  description: code,
  content: { "application/json": { schema: z.object({ code: z.literal(code), ...extra }) } },
});
const json = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

export const onboardingRoutes = (deps: Deps) => {
  const actor = (c: {
    get: (k: "session") => { user: { id: string } } | null;
    req: { header: (n: string) => string | undefined };
  }) => {
    const s = c.get("session");
    return {
      id: s?.user.id ?? "",
      ip: clientIp((n) => c.req.header(n), deps.env.FARMHAND_TRUSTED_IP_HEADER),
    };
  };
  const lanCheck = async (ip: string) =>
    checkTarget(ip, {
      lan: true,
      lanIfaces: (await deps.settings.read()).lanIfaces,
      allowLoopback: deps.env.FARMHAND_DEV_ALLOW_LOOPBACK,
    });

  return new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/candidates",
        tags: ["onboarding"],
        middleware: [requireRole("viewer")],
        responses: {
          200: json(
            z.object({ items: z.array(CandidateOut) }),
            "Printers seen on the LAN that are not approved or dismissed",
          ),
        },
      }),
      async (c) =>
        c.json({ items: (await deps.candidates.pending()).map(({ dismissedAt: _d, ...r }) => r) }, 200),
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/candidates/{host}/{port}/dismiss",
        tags: ["onboarding"],
        middleware: [requireRole("operator")],
        request: { params: z.object({ host: z.string(), port: z.coerce.number().int() }) },
        responses: {
          200: json(z.object({ ok: z.literal(true) }), "Hidden until it is seen again after a reset"),
          404: Err("not_found"),
        },
      }),
      async (c) => {
        const { host, port } = c.req.valid("param");
        const r = await deps.db
          .update(candidates)
          .set({ dismissedAt: new Date().toISOString() })
          .where(and(eq(candidates.host, host), eq(candidates.port, port)))
          .returning({ host: candidates.host });
        if (!r.length) return c.json({ code: "not_found" as const }, 404);
        deps.live.emit({ type: "candidates", changedAt: new Date().toISOString() });
        return c.json({ ok: true as const }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/discovery/run",
        tags: ["onboarding"],
        middleware: [requireRole("operator"), rateLimit("discovery", 2, 30_000)],
        responses: {
          202: json(z.object({ started: z.literal(true) }), "Discovery started; results arrive over /events"),
          409: Err("busy"),
        },
      }),
      async (c) => {
        const r = deps.discovery.run({ notify: false });
        if ("busy" in r) return c.json({ code: "busy" as const }, 409);
        const s = c.get("session");
        const opId = await deps.operations.open("discover", actor(c), null, {});
        void r.then(() =>
          deps.operations.update(opId, { status: deps.live.discovery.lastError ? "failed" : "complete" }),
        );
        void s;
        return c.json({ started: true as const }, 202);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/discovery/probe",
        tags: ["onboarding"],
        middleware: [requireRole("operator"), rateLimit("probe", 10, 60_000)],
        request: { body: { content: { "application/json": { schema: TargetSchema } } } },
        responses: {
          200: json(
            z.object({ identity: Identity, candidate: CandidateOut }),
            "Reachable Moonraker; recorded as a manual candidate",
          ),
          422: Err("rejected", { reason: z.string() }),
        },
      }),
      async (c) => {
        const { ip, port } = c.req.valid("json");
        const t = await lanCheck(ip);
        if (!t.ok) return c.json({ code: "rejected" as const, reason: t.code }, 422);
        const probe = await probeMoonraker(ip, port);
        if (!probe.ok) return c.json({ code: "rejected" as const, reason: probe.error }, 422);
        await deps.discovery.record([{ host: ip, port, source: "manual", ...probe.identity }]);
        const row = await deps.db.query.candidates.findFirst({
          where: and(eq(candidates.host, ip), eq(candidates.port, port)),
        });
        if (!row) return c.json({ code: "rejected" as const, reason: "record_failed" }, 422);
        const { dismissedAt: _d, ...candidate } = row;
        return c.json({ identity: probe.identity, candidate }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/approvals/preview",
        tags: ["onboarding"],
        middleware: [requireRole("operator"), rateLimit("preview", 10, 60_000)],
        request: { body: { content: { "application/json": { schema: ApprovalPreviewSchema } } } },
        responses: {
          200: json(
            z.object({
              printer: z.object({
                host: z.string(),
                port: z.number(),
                name: z.string(),
                url: z.string(),
                identity: Identity,
              }),
              effects: z.array(Effect),
              confirmToken: z.string(),
              expiresAt: z.string(),
            }),
            "What approving would change, plus a single-use token to do it",
          ),
          422: Err("rejected", { reason: z.string() }),
        },
      }),
      async (c) => {
        const body = c.req.valid("json");
        const t = await lanCheck(body.ip);
        if (!t.ok) return c.json({ code: "rejected" as const, reason: t.code }, 422);
        const p = await deps.approval.preview(body.ip, body.port);
        if (!p.ok) return c.json({ code: "rejected" as const, reason: p.error }, 422);
        // A hostname comes from the device itself; it only becomes the name when it passes the same rules as typed input.
        const hostname = p.identity.hostname?.trim().slice(0, 80);
        const name = body.name ?? (hostname && nameProblem(hostname) === null ? hostname : body.ip);
        const input = { host: body.ip, port: body.port, name };
        const { token, expiresAt } = deps.confirm.mint("approve", input, actor(c).id);
        return c.json(
          {
            printer: { ...input, url: moonrakerHttp(body.ip, body.port), identity: p.identity },
            effects: p.effects,
            confirmToken: token,
            expiresAt,
          },
          200,
        );
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/approvals",
        tags: ["onboarding"],
        middleware: [requireRole("operator"), rateLimit("approve", 5, 60_000)],
        request: {
          body: {
            content: {
              "application/json": {
                schema: ConfirmTokenSchema.extend({ host: z.string(), port: z.number(), name: z.string() }),
              },
            },
          },
        },
        responses: {
          200: json(
            z.object({ operationId: z.string(), printerId: z.string(), steps: z.array(StepSchema) }),
            "Steps ran; see each status",
          ),
          403: Err("bad_token", { reason: z.string() }),
          409: Err("busy"),
          422: Err("rejected", { reason: z.string() }),
        },
      }),
      async (c) => {
        const { confirmToken, ...input } = c.req.valid("json");
        const who = actor(c);
        const tok = deps.confirm.redeem(confirmToken, "approve", input, who.id);
        if (!tok.ok) return c.json({ code: "bad_token" as const, reason: tok.code }, 403);
        const release = deps.lock.tryAcquire("approve");
        if (!release) return c.json({ code: "busy" as const }, 409);
        try {
          const r = await deps.approval.approve(input, who);
          if (!r.ok) return c.json({ code: "rejected" as const, reason: r.error }, 422);
          return c.json({ operationId: r.operationId, printerId: r.printerId, steps: r.steps }, 200);
        } finally {
          release();
        }
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/printers/{id}/repair",
        tags: ["onboarding"],
        middleware: [requireRole("operator"), rateLimit("repair", 5, 60_000)],
        request: {
          params: z.object({ id: z.string() }),
          body: { content: { "application/json": { schema: z.object({ confirm: z.literal(true) }) } } },
        },
        responses: {
          200: json(
            z.object({ operationId: z.string(), steps: z.array(StepSchema) }),
            "Only failed or unknown steps were re-run",
          ),
          404: Err("not_found"),
          409: Err("busy"),
        },
      }),
      async (c) => {
        const release = deps.lock.tryAcquire("repair");
        if (!release) return c.json({ code: "busy" as const }, 409);
        try {
          const r = await deps.approval.repair(c.req.valid("param").id, actor(c));
          if (!r.ok) return c.json({ code: "not_found" as const }, 404);
          return c.json({ operationId: r.operationId, steps: r.steps }, 200);
        } finally {
          release();
        }
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/printers/{id}/diagnostics",
        tags: ["onboarding"],
        middleware: [requireRole("operator"), rateLimit("diagnostics", 6, 60_000)],
        request: { params: z.object({ id: z.string() }) },
        responses: {
          200: json(
            z.object({
              checkedAt: z.string(),
              moonraker: z.union([
                z.object({ ok: z.literal(true), identity: Identity }),
                z.object({ ok: z.literal(false), error: z.string() }),
              ]),
              effects: z.array(Effect),
              live: z.unknown().nullable(),
            }),
            "Fresh probe of the printer and of every integration",
          ),
          404: Err("not_found"),
        },
      }),
      async (c) => {
        const row = await deps.db.query.printers.findFirst({
          where: eq(printers.id, c.req.valid("param").id),
        });
        if (!row) return c.json({ code: "not_found" as const }, 404);
        const p = await deps.approval.preview(row.host, row.port);
        const checkedAt = new Date().toISOString();
        if (p.ok) {
          const integrations = { ...row.integrations };
          for (const e of p.effects) {
            integrations[e.id] = {
              status:
                e.willDo === "already" ? "already_configured" : e.willDo === "add" ? "failed" : "unknown",
              message: e.willDo === "add" ? "missing" : e.detail,
              checkedAt,
            };
          }
          await deps.db
            .update(printers)
            .set({ integrations, updatedAt: checkedAt })
            .where(eq(printers.id, row.id));
        }
        return c.json(
          {
            checkedAt,
            moonraker: p.ok
              ? { ok: true as const, identity: p.identity }
              : { ok: false as const, error: p.error },
            effects: p.ok ? p.effects : [],
            live: deps.live.printers.get(row.id) ?? null,
          },
          200,
        );
      },
    );
};
