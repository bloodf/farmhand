import type {
  AppHealth,
  AppId,
  DiscoveryState,
  OperationKind,
  OperationStatus,
  PrinterLive,
  Role,
  ServiceId,
  Step,
  StepId,
  StepStatus,
} from "@farmhand/contracts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: string;
}
export type Session = { session: unknown; user: SessionUser } | null;

export interface Settings {
  discoveryIntervalMin: number;
  lanIfaces: string[];
  lowStockGrams: number;
  availableIfaces: string[];
}

export interface Integrations {
  lanIp: string | null;
  helper: "socket" | "fake";
  printstash: { url: string; credentials: boolean; publicUrl: string | null };
  fdm: { url: string; credentials: boolean; publicUrl: string | null };
  spoolman: { url: string; publicUrl: string | null };
  orcaslicer: { url: string; publicUrl: string | null };
  homeAssistant: { configured: boolean };
}

export interface Operation {
  id: string;
  kind: OperationKind;
  actorId: string | null;
  target: string | null;
  input: Record<string, unknown>;
  status: OperationStatus;
  steps: Step[];
  startedAt: string;
  finishedAt: string | null;
}

export interface Overview {
  generatedAt: string;
  printers: { approved: number; printing: number; offline: number; pending: number };
  stock: {
    source: "ok" | "unavailable";
    checkedAt: string;
    error: string | null;
    spools: number;
    knownGrams: number;
    spoolsWithoutWeight: number;
    lowStock: { id: string | number; name: string; material: string | null; remainingGrams: number }[];
    byMaterial: {
      material: string | null;
      spools: number;
      knownGrams: number;
      spoolsWithoutWeight: number;
    }[];
  };
  apps: AppHealth[];
}

export interface Printer {
  id: string;
  name: string;
  host: string;
  port: number;
  source: "discovery" | "manual" | "adopted";
  approvedAt: string;
  integrations: Record<StepId, { status: StepStatus; message: string; checkedAt: string | null }>;
  live: PrinterLive | null;
}

export interface Snippets {
  moonrakerUrl: string;
  websocketUrl: string;
  lanIp: string | null;
  spoolmanConf: string | null;
}

export interface AppEntry {
  id: AppId;
  label: string;
  url: string | null;
  health: AppHealth;
}

export interface Candidate {
  host: string;
  port: number;
  name: string | null;
  klippyState: string | null;
  moonrakerVersion: string | null;
  source: "mdns" | "neigh" | "manual";
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LiveState {
  at: string;
  printers: Map<string, PrinterLive>;
  apps: AppHealth[];
  discovery: DiscoveryState;
}

export interface Identity {
  klippyState: string;
  moonrakerVersion: string;
  hostname: string | null;
}

export interface Effect {
  id: StepId;
  willDo: "add" | "already" | "unknown";
  detail: string;
}

export interface ServiceRow {
  id: ServiceId;
  label: string;
  state: "running" | "exited" | "missing" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none";
}

export interface Services {
  items: ServiceRow[];
  guard: string;
  helper: "socket" | "fake";
}

export interface BackupStatus {
  activeState: string;
  result: string;
  startedAt: string | null;
  finishedAt: string | null;
}
