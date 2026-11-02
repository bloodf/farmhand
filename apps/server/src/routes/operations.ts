import { OPERATION_KINDS, OPERATION_STATUSES, StepSchema } from "@farmhand/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Deps } from "../deps.js";
import { type AppEnv, requireRole } from "../middleware/session.js";

export const OperationOut = z.object({
  id: z.string(),
  kind: z.enum(OPERATION_KINDS),
  actorId: z.string().nullable(),
  target: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(OPERATION_STATUSES),
  steps: z.array(StepSchema),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

const strip = (row: { actorIp: string | null } & z.infer<typeof OperationOut>) => {
  const { actorIp: _ip, ...rest } = row;
  return rest;
};

export const operationsRoutes = (deps: Deps) =>
  new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/operations",
        tags: ["operations"],
        middleware: [requireRole("viewer")],
        request: {
          query: z.object({
            kind: z.enum(OPERATION_KINDS).optional(),
            before: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(200).optional(),
          }),
        },
        responses: {
          200: {
            description: "Newest first",
            content: { "application/json": { schema: z.object({ items: z.array(OperationOut) }) } },
          },
        },
      }),
      async (c) => c.json({ items: (await deps.operations.list(c.req.valid("query"))).map(strip) }, 200),
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/operations/{id}",
        tags: ["operations"],
        middleware: [requireRole("viewer")],
        request: { params: z.object({ id: z.string() }) },
        responses: {
          200: { description: "One operation", content: { "application/json": { schema: OperationOut } } },
          404: {
            description: "No such operation",
            content: { "application/json": { schema: z.object({ code: z.literal("not_found") }) } },
          },
        },
      }),
      async (c) => {
        const row = await deps.operations.get(c.req.valid("param").id);
        return row ? c.json(strip(row), 200) : c.json({ code: "not_found" as const }, 404);
      },
    );
