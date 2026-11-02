/** In-memory live state plus an event bus the SSE route subscribes to. Nothing here is persisted. */
import { EventEmitter } from "node:events";
import type { AppHealth, DiscoveryState, FarmEvent, PrinterLive, ServiceId } from "@farmhand/contracts";

export class LiveStore {
  readonly printers = new Map<string, PrinterLive>();
  readonly apps = new Map<ServiceId, AppHealth>();
  discovery: DiscoveryState = { running: false, lastRunAt: null, lastError: null };
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(200);
  }

  snapshot(): FarmEvent {
    return {
      type: "snapshot",
      at: new Date().toISOString(),
      printers: [...this.printers.values()],
      apps: [...this.apps.values()],
      discovery: this.discovery,
    };
  }

  setPrinter(live: PrinterLive) {
    this.printers.set(live.id, live);
    this.emit({ type: "printer", printer: live });
  }

  removePrinter(id: string) {
    this.printers.delete(id);
  }

  setApp(app: AppHealth) {
    this.apps.set(app.id, app);
    this.emit({ type: "app", app });
  }

  setDiscovery(d: DiscoveryState) {
    this.discovery = d;
    this.emit({ type: "discovery", discovery: d });
  }

  emit(e: FarmEvent) {
    this.bus.emit("event", e);
  }

  subscribe(fn: (e: FarmEvent) => void): () => void {
    this.bus.on("event", fn);
    return () => this.bus.off("event", fn);
  }
}
