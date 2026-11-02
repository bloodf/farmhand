/**
 * The only path to root. Fixed verbs, JSON in, JSON out over a Unix socket
 * (deploy/helper/farmhand-helper). The fake implementation writes to a
 * directory so the whole approval flow runs in development and tests.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { nameProblem, SERVICE_IDS, type ServiceId } from "@farmhand/contracts";

export type HelperResult<T = object> = ({ ok: true } & T) | { ok: false; code: string; message: string };

export interface ServiceState {
  service: ServiceId;
  state: "running" | "exited" | "missing" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none";
}

export interface Helper {
  readonly kind: "socket" | "fake";
  ping(): Promise<HelperResult>;
  status(): Promise<HelperResult<{ services: ServiceState[]; guard: string }>>;
  allowlistAdd(ip: string): Promise<HelperResult<{ already: boolean }>>;
  allowlistList(): Promise<HelperResult<{ ips: string[] }>>;
  mobilerakerAdd(ip: string, port: number, name: string): Promise<HelperResult<{ already: boolean }>>;
  mobilerakerList(): Promise<HelperResult<{ uris: string[] }>>;
  restart(service: ServiceId): Promise<HelperResult<{ acceptedAt: string; ready: boolean; state: string }>>;
  logs(source: string): Promise<HelperResult<{ lines: string[] }>>;
  backupStart(): Promise<HelperResult<{ acceptedAt: string }>>;
  backupStatus(): Promise<
    HelperResult<{ activeState: string; result: string; startedAt: string | null; finishedAt: string | null }>
  >;
}

const HELPER_TIMEOUT_MS = 130_000;
const MAX_RESPONSE = 512 * 1024;

/** One request per connection, newline-delimited JSON, as farm-helper.py does today. */
export class SocketHelper implements Helper {
  readonly kind = "socket" as const;
  constructor(private readonly path: string) {}

  private call<T>(req: Record<string, unknown>, timeoutMs = HELPER_TIMEOUT_MS): Promise<HelperResult<T>> {
    return new Promise((resolve) => {
      const conn = createConnection(this.path);
      let buf = "";
      const fail = (code: string, message: string) => resolve({ ok: false, code, message });
      const timer = setTimeout(() => {
        conn.destroy();
        fail("timeout", "helper timed out; outcome unknown");
      }, timeoutMs);
      conn.on("connect", () => conn.write(`${JSON.stringify(req)}\n`));
      conn.on("data", (c) => {
        buf += c.toString("utf8");
        if (buf.length > MAX_RESPONSE) conn.destroy(new Error("too large"));
      });
      conn.on("error", (e) => {
        clearTimeout(timer);
        fail("unavailable", (e as { code?: string }).code ?? "socket error");
      });
      conn.on("close", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(buf.split("\n", 1)[0] ?? "") as HelperResult<T>);
        } catch {
          fail("bad_output", "helper closed without a response");
        }
      });
    });
  }

  ping() {
    return this.call({ op: "ping" }, 5000);
  }
  status() {
    return this.call<{ services: ServiceState[]; guard: string }>({ op: "status" }, 20_000);
  }
  allowlistAdd(ip: string) {
    return this.call<{ already: boolean }>({ op: "allowlist-add", ip }, 30_000);
  }
  allowlistList() {
    return this.call<{ ips: string[] }>({ op: "allowlist-list" }, 5000);
  }
  mobilerakerAdd(ip: string, port: number, name: string) {
    return this.call<{ already: boolean }>({ op: "mobileraker-add", ip, port, name });
  }
  mobilerakerList() {
    return this.call<{ uris: string[] }>({ op: "mobileraker-list" }, 5000);
  }
  restart(service: ServiceId) {
    return this.call<{ acceptedAt: string; ready: boolean; state: string }>({ op: "restart", service });
  }
  logs(source: string) {
    return this.call<{ lines: string[] }>({ op: "logs", source }, 20_000);
  }
  backupStart() {
    return this.call<{ acceptedAt: string }>({ op: "backup-start" }, 10_000);
  }
  backupStatus() {
    return this.call<{
      activeState: string;
      result: string;
      startedAt: string | null;
      finishedAt: string | null;
    }>({ op: "backup-status" }, 5000);
  }
}

/** Writes an allowlist and a mobileraker.conf under `dir`; restarts are pretend. */
export class FakeHelper implements Helper {
  readonly kind = "fake" as const;
  readonly restarted: ServiceId[] = [];
  backup: { activeState: string; result: string; startedAt: string | null; finishedAt: string | null } = {
    activeState: "inactive",
    result: "success",
    startedAt: null,
    finishedAt: null,
  };
  failNext = new Set<"allowlist" | "mobileraker">();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private read(name: string) {
    try {
      return readFileSync(join(this.dir, name), "utf8");
    } catch {
      return "";
    }
  }
  private write(name: string, text: string) {
    const tmp = join(this.dir, `.${name}.tmp`);
    writeFileSync(tmp, text);
    renameSync(tmp, join(this.dir, name));
  }

  async ping(): Promise<HelperResult> {
    return { ok: true };
  }
  async status(): Promise<HelperResult<{ services: ServiceState[]; guard: string }>> {
    return {
      ok: true,
      services: SERVICE_IDS.map((service) => ({
        service,
        state:
          service === "mobileraker" && !this.read("mobileraker.conf").includes("[printer")
            ? "exited"
            : "running",
        health: "healthy",
      })),
      guard: "active",
    };
  }
  async allowlistList(): Promise<HelperResult<{ ips: string[] }>> {
    return {
      ok: true,
      ips: this.read("printers.allow")
        .split("\n")
        .map((l) => l.split("#")[0]?.trim() ?? "")
        .filter(Boolean),
    };
  }
  async allowlistAdd(ip: string): Promise<HelperResult<{ already: boolean }>> {
    if (this.failNext.delete("allowlist"))
      return { ok: false, code: "failed", message: "fixture forced failure" };
    const cur = await this.allowlistList();
    if (!cur.ok) return cur;
    if (cur.ips.includes(ip)) return { ok: true, already: true };
    this.write("printers.allow", `${this.read("printers.allow")}${ip}\n`);
    return { ok: true, already: false };
  }
  async mobilerakerList(): Promise<HelperResult<{ uris: string[] }>> {
    const uris = [...this.read("mobileraker.conf").matchAll(/^moonraker_uri:\s*(\S+)/gm)].map(
      (m) => m[1] ?? "",
    );
    return { ok: true, uris };
  }
  async mobilerakerAdd(ip: string, port: number, name: string): Promise<HelperResult<{ already: boolean }>> {
    if (this.failNext.delete("mobileraker"))
      return { ok: false, code: "failed", message: "fixture forced failure" };
    if (nameProblem(name)) return { ok: false, code: "invalid", message: "invalid name" };
    const uri = `ws://${ip}:${port}/websocket`;
    const cur = await this.mobilerakerList();
    if (cur.ok && cur.uris.includes(uri)) return { ok: true, already: true };
    const conf = this.read("mobileraker.conf") || "[general]\ntimezone: UTC\n";
    const section = conf.includes(`[printer ${name}]`) ? `${name}-${ip}` : name;
    this.write("mobileraker.conf", `${conf}\n[printer ${section}]\nmoonraker_uri: ${uri}\n`);
    return { ok: true, already: false };
  }
  async restart(
    service: ServiceId,
  ): Promise<HelperResult<{ acceptedAt: string; ready: boolean; state: string }>> {
    if (service === "mobileraker" && !this.read("mobileraker.conf").includes("[printer")) {
      return { ok: false, code: "waiting", message: "companion waits for an approved printer" };
    }
    this.restarted.push(service);
    return { ok: true, acceptedAt: new Date().toISOString(), ready: true, state: "running healthy" };
  }
  async logs(source: string): Promise<HelperResult<{ lines: string[] }>> {
    return { ok: true, lines: [`${source}: fake log line 1`, `${source}: Authorization: Bearer [redacted]`] };
  }
  async backupStart(): Promise<HelperResult<{ acceptedAt: string }>> {
    const at = new Date().toISOString();
    this.backup = { activeState: "active", result: "success", startedAt: at, finishedAt: null };
    setTimeout(() => {
      this.backup = {
        activeState: "inactive",
        result: "success",
        startedAt: at,
        finishedAt: new Date().toISOString(),
      };
    }, 200);
    return { ok: true, acceptedAt: at };
  }
  async backupStatus() {
    return { ok: true as const, ...this.backup };
  }
}

export const createHelper = (spec: string, fakeDir: string): Helper =>
  spec === "fake"
    ? new FakeHelper(fakeDir || join(process.cwd(), ".farmhand-fake-helper"))
    : new SocketHelper(spec);
