import { networkInterfaces } from "node:os";
import { SettingsPatchSchema } from "@farmhand/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Deps } from "../deps.js";
import { type AppEnv, requireRole } from "../middleware/session.js";

const SettingsOut = z.object({
  discoveryIntervalMin: z.number(),
  lanIfaces: z.array(z.string()),
  lowStockGrams: z.number(),
  availableIfaces: z.array(z.string()),
});

const IntegrationsOut = z.object({
  lanIp: z.string().nullable(),
  helper: z.enum(["socket", "fake"]),
  printstash: z.object({ url: z.string(), credentials: z.boolean(), publicUrl: z.string().nullable() }),
  fdm: z.object({ url: z.string(), credentials: z.boolean(), publicUrl: z.string().nullable() }),
  spoolman: z.object({ url: z.string(), publicUrl: z.string().nullable() }),
  orcaslicer: z.object({ url: z.string(), publicUrl: z.string().nullable() }),
  homeAssistant: z.object({ configured: z.boolean() }),
});

const ifaceNames = () => Object.keys(networkInterfaces()).filter((n) => n !== "lo");

export const settingsRoutes = (deps: Deps) =>
  new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/settings",
        tags: ["settings"],
        middleware: [requireRole("viewer")],
        responses: {
          200: { description: "Current settings", content: { "application/json": { schema: SettingsOut } } },
        },
      }),
      async (c) => c.json({ ...(await deps.settings.read()), availableIfaces: ifaceNames() }, 200),
    )
    .openapi(
      createRoute({
        method: "patch",
        path: "/settings",
        tags: ["settings"],
        middleware: [requireRole("admin")],
        request: { body: { content: { "application/json": { schema: SettingsPatchSchema } } } },
        responses: {
          200: { description: "Updated settings", content: { "application/json": { schema: SettingsOut } } },
          422: {
            description: "Unknown interface",
            content: {
              "application/json": {
                schema: z.object({ code: z.literal("unknown_iface"), iface: z.string() }),
              },
            },
          },
        },
      }),
      async (c) => {
        const patch = c.req.valid("json");
        const known = ifaceNames();
        const bad = patch.lanIfaces?.find((i) => !known.includes(i));
        if (bad) return c.json({ code: "unknown_iface" as const, iface: bad }, 422);
        const s = c.get("session");
        const actor = s ? { id: s.user.id, ip: c.req.header("x-forwarded-for") ?? null } : null;
        const opId = await deps.operations.open("settings", actor, null, patch);
        const next = await deps.settings.write(patch, s?.user.id ?? null);
        await deps.operations.update(opId, { status: "complete" });
        return c.json({ ...next, availableIfaces: known }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/settings/integrations",
        tags: ["settings"],
        middleware: [requireRole("admin")],
        responses: {
          200: {
            description: "Which integrations are configured. Never returns secret values.",
            content: { "application/json": { schema: IntegrationsOut } },
          },
        },
      }),
      (c) => {
        const e = deps.env;
        const orNull = (s: string) => (s ? s : null);
        return c.json(
          {
            lanIp: orNull(e.FARMHAND_LAN_IP),
            helper: e.FARMHAND_HELPER === "fake" ? ("fake" as const) : ("socket" as const),
            printstash: {
              url: e.PRINTSTASH_URL,
              credentials: Boolean(e.PRINTSTASH_USER && e.PRINTSTASH_PASSWORD),
              publicUrl: orNull(e.PRINTSTASH_PUBLIC_URL),
            },
            fdm: {
              url: e.FDM_URL,
              credentials: Boolean(e.FDM_USER && e.FDM_PASSWORD),
              publicUrl: orNull(e.FDM_PUBLIC_URL),
            },
            spoolman: { url: e.SPOOLMAN_URL, publicUrl: orNull(e.SPOOLMAN_PUBLIC_URL) },
            orcaslicer: { url: e.ORCASLICER_URL, publicUrl: orNull(e.ORCASLICER_PUBLIC_URL) },
            homeAssistant: { configured: Boolean(e.HA_URL && e.HA_DISCOVERY_WEBHOOK) },
          },
          200,
        );
      },
    );
