/** The only compose services farmhand may restart or read logs from. */
export const SERVICE_IDS = [
  "spoolman",
  "printstash",
  "fdm-monster",
  "orcaslicer",
  "mainsail",
  "mobileraker",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const SERVICE_LABELS: Record<ServiceId, string> = {
  spoolman: "Spoolman",
  printstash: "PrintStash",
  "fdm-monster": "FDM Monster",
  orcaslicer: "OrcaSlicer",
  mainsail: "Mainsail",
  mobileraker: "Mobileraker companion",
};

export const LOG_SOURCES = [...SERVICE_IDS, "guard"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/** Apps with a web UI the operator can open. Mobileraker is a companion with no UI. */
export const APP_IDS = ["printstash", "spoolman", "fdm-monster", "orcaslicer", "mainsail"] as const;
export type AppId = (typeof APP_IDS)[number];

/** Onboarding steps, in the order they run. */
export const STEP_IDS = ["allowlist", "printstash", "fdm", "mobileraker"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_STATUSES = ["success", "already_configured", "failed", "unknown", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface Step {
  id: StepId;
  status: StepStatus;
  /** Short, sanitized, never raw upstream output. */
  message: string;
}

export const OPERATION_KINDS = [
  "approve",
  "repair",
  "discover",
  "restart",
  "backup",
  "settings",
  "user",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_STATUSES = ["running", "complete", "partial", "failed", "unknown"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const ROLES = ["viewer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const LOCALES = ["en-US", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];
