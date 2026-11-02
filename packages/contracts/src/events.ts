import { z } from "zod";
import { OPERATION_KINDS, OPERATION_STATUSES, SERVICE_IDS, STEP_IDS, STEP_STATUSES } from "./services.js";

export const TempSchema = z.object({ actual: z.number(), target: z.number() });

export const PrinterLiveSchema = z.object({
  id: z.string(),
  connection: z.enum([
    "connecting",
    "online",
    "offline",
    "klippy_startup",
    "klippy_error",
    "klippy_shutdown",
  ]),
  state: z.enum(["standby", "printing", "paused", "complete", "cancelled", "error"]).nullable(),
  filename: z.string().nullable(),
  /** 0..1 */
  progress: z.number().min(0).max(1).nullable(),
  printDurationS: z.number().nullable(),
  message: z.string().nullable(),
  temps: z.object({ extruder: TempSchema.optional(), bed: TempSchema.optional() }),
  updatedAt: z.string(),
  /** No frame from the printer for more than 30 s. */
  stale: z.boolean(),
});
export type PrinterLive = z.infer<typeof PrinterLiveSchema>;

export const AppHealthSchema = z.object({
  id: z.enum(SERVICE_IDS),
  status: z.enum(["up", "down", "unknown"]),
  checkedAt: z.string(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type AppHealth = z.infer<typeof AppHealthSchema>;

export const StepSchema = z.object({
  id: z.enum(STEP_IDS),
  status: z.enum(STEP_STATUSES),
  message: z.string(),
});

export const DiscoveryStateSchema = z.object({
  running: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type DiscoveryState = z.infer<typeof DiscoveryStateSchema>;

export const FarmEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    at: z.string(),
    printers: z.array(PrinterLiveSchema),
    apps: z.array(AppHealthSchema),
    discovery: DiscoveryStateSchema,
  }),
  z.object({ type: z.literal("printer"), printer: PrinterLiveSchema }),
  z.object({ type: z.literal("app"), app: AppHealthSchema }),
  z.object({ type: z.literal("candidates"), changedAt: z.string() }),
  z.object({ type: z.literal("discovery"), discovery: DiscoveryStateSchema }),
  z.object({
    type: z.literal("operation"),
    id: z.string(),
    kind: z.enum(OPERATION_KINDS),
    status: z.enum(OPERATION_STATUSES),
    steps: z.array(StepSchema),
  }),
]);
export type FarmEvent = z.infer<typeof FarmEventSchema>;
