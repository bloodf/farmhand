import type { LogSource } from "@farmhand/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, fetchJson } from "./api";
import type {
  AppEntry,
  BackupStatus,
  Candidate,
  Integrations,
  Operation,
  Overview,
  Printer,
  Services,
  Session,
  Settings,
  Snippets,
} from "./types";

const list = <T>(path: string) => fetchJson<{ items: T[] }>(path).then((r) => r.items);

export const q = {
  setupStatus: queryOptions({
    queryKey: ["setup-status"],
    queryFn: () => fetchJson<{ needsSetup: boolean }>("/setup/status"),
    staleTime: 60_000,
  }),
  session: queryOptions({
    queryKey: ["session"],
    queryFn: async (): Promise<Session> => {
      try {
        const s = await fetchJson<Session>("/auth/get-session");
        return s?.user ? s : null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  }),
  overview: queryOptions({
    queryKey: ["overview"],
    queryFn: () => fetchJson<Overview>("/overview"),
    refetchInterval: 30_000,
  }),
  printers: queryOptions({ queryKey: ["printers"], queryFn: () => list<Printer>("/printers") }),
  printer: (id: string) =>
    queryOptions({
      queryKey: ["printers", id],
      queryFn: () => fetchJson<Printer>(`/printers/${encodeURIComponent(id)}`),
    }),
  snippets: (id: string) =>
    queryOptions({
      queryKey: ["printers", id, "snippets"],
      queryFn: () => fetchJson<Snippets>(`/printers/${encodeURIComponent(id)}/snippets`),
    }),
  apps: queryOptions({ queryKey: ["apps"], queryFn: () => list<AppEntry>("/apps") }),
  candidates: queryOptions({
    queryKey: ["candidates"],
    queryFn: () => list<Candidate>("/candidates"),
  }),
  services: queryOptions({ queryKey: ["services"], queryFn: () => fetchJson<Services>("/services") }),
  backupStatus: queryOptions({
    queryKey: ["backup-status"],
    queryFn: () => fetchJson<BackupStatus>("/backups/status"),
  }),
  logs: (source: LogSource) =>
    queryOptions({
      queryKey: ["logs", source],
      queryFn: () => fetchJson<{ source: LogSource; lines: string[]; fetchedAt: string }>(`/logs/${source}`),
      staleTime: 0,
    }),
  settings: queryOptions({ queryKey: ["settings"], queryFn: () => fetchJson<Settings>("/settings") }),
  integrations: queryOptions({
    queryKey: ["settings", "integrations"],
    queryFn: () => fetchJson<Integrations>("/settings/integrations"),
  }),
  operations: queryOptions({
    queryKey: ["operations"],
    queryFn: () => list<Operation>("/operations?limit=100"),
  }),
};
