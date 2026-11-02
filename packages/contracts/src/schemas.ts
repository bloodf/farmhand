import { z } from "zod";
import { nameProblem } from "./names.js";
import { DEFAULT_MOONRAKER_PORT, IPV4_PATTERN, PORT_MAX, PORT_MIN } from "./net.js";
import { LOCALES, LOG_SOURCES, SERVICE_IDS } from "./services.js";

export const IpSchema = z.string().max(15).regex(IPV4_PATTERN, "invalid_ipv4");
export const PortSchema = z.number().int().min(PORT_MIN).max(PORT_MAX);
export const NameSchema = z.string().refine((v) => nameProblem(v) === null, { message: "invalid_name" });

export const TargetSchema = z
  .object({ ip: IpSchema, port: PortSchema.default(DEFAULT_MOONRAKER_PORT) })
  .strict();
export type TargetInput = z.infer<typeof TargetSchema>;

export const ApprovalPreviewSchema = TargetSchema.extend({ name: NameSchema.optional() }).strict();
export type ApprovalPreviewInput = z.infer<typeof ApprovalPreviewSchema>;

export const ConfirmTokenSchema = z.object({ confirmToken: z.string().min(16).max(2048) }).strict();

export const ConfirmSchema = z.object({ confirm: z.literal(true) }).strict();

export const RestartSchema = z.object({ service: z.enum(SERVICE_IDS) }).strict();
export const LogsQuerySchema = z.object({ source: z.enum(LOG_SOURCES) }).strict();

export const SettingsPatchSchema = z
  .object({
    discoveryIntervalMin: z.number().int().min(1).max(1440).optional(),
    lanIfaces: z
      .array(z.string().regex(/^[A-Za-z0-9_.-]{1,15}$/))
      .min(1)
      .max(8)
      .optional(),
    lowStockGrams: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SetupSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.email().max(254),
    password: z.string().min(12).max(256),
    locale: z.enum(LOCALES).default("en-US"),
  })
  .strict();
export type SetupInput = z.infer<typeof SetupSchema>;
