import { type FarmEvent, FarmEventSchema } from "@farmhand/contracts";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { LiveState } from "./types";

export type LiveStatus = "live" | "reconnecting" | "offline";

let status: LiveStatus = "offline";
const listeners = new Set<() => void>();
const setStatus = (next: LiveStatus) => {
  status = next;
  for (const l of listeners) l();
};

export const useLiveStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );

export const LIVE_KEY = ["live"] as const;

/** Live snapshot written by the event stream. `undefined` until the first snapshot arrives. */
export const useLive = () =>
  useQuery<LiveState>({ queryKey: LIVE_KEY, queryFn: () => Promise.reject(), enabled: false });

// The server sends every frame as `event: farm`; the rest are kept for older servers.
const EVENT_TYPES = ["farm", "snapshot", "printer", "app", "candidates", "discovery", "operation"] as const;
const MAX_BACKOFF_MS = 30_000;
const OFFLINE_AFTER_FAILURES = 3;

export function applyEvent(qc: QueryClient, ev: FarmEvent) {
  const update = (fn: (s: LiveState) => LiveState) =>
    qc.setQueryData<LiveState>(LIVE_KEY, (s) => (s ? fn(s) : s));
  switch (ev.type) {
    case "snapshot":
      qc.setQueryData<LiveState>(LIVE_KEY, {
        at: ev.at,
        printers: new Map(ev.printers.map((p) => [p.id, p])),
        apps: ev.apps,
        discovery: ev.discovery,
      });
      return;
    case "printer":
      update((s) => ({ ...s, printers: new Map(s.printers).set(ev.printer.id, ev.printer) }));
      return;
    case "app":
      update((s) => ({ ...s, apps: [...s.apps.filter((a) => a.id !== ev.app.id), ev.app] }));
      return;
    case "discovery":
      update((s) => ({ ...s, discovery: ev.discovery }));
      return;
    case "candidates":
      qc.invalidateQueries({ queryKey: ["candidates"] });
      return;
    case "operation":
      qc.setQueryData(["operation", ev.id], ev);
      qc.invalidateQueries({ queryKey: ["operations"] });
      return;
  }
}

/** Opens the event stream and keeps it open with backoff. Returns a stop function. */
export function startLive(qc: QueryClient): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;

  const onFrame = (e: MessageEvent<string>) => {
    let raw: unknown;
    try {
      raw = JSON.parse(e.data);
    } catch {
      return;
    }
    const parsed = FarmEventSchema.safeParse(raw);
    if (parsed.success) applyEvent(qc, parsed.data);
  };

  const connect = () => {
    es = new EventSource("/api/events");
    es.onopen = () => {
      failures = 0;
      setStatus("live");
    };
    es.onmessage = onFrame;
    for (const t of EVENT_TYPES) es.addEventListener(t, onFrame);
    es.onerror = () => {
      es?.close();
      if (stopped) return;
      failures += 1;
      setStatus(failures >= OFFLINE_AFTER_FAILURES ? "offline" : "reconnecting");
      timer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)));
    };
  };

  qc.setQueryDefaults(LIVE_KEY, { gcTime: Number.POSITIVE_INFINITY, staleTime: Number.POSITIVE_INFINITY });
  setStatus("reconnecting");
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    es?.close();
    qc.removeQueries({ queryKey: LIVE_KEY });
    setStatus("offline");
  };
}
