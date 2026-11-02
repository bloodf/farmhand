/** FDM Monster 2.1.x: login, list printers, register a Moonraker printer. FDM probes the printer on create. */
import { z } from "zod";
import { fetchJson } from "./http.js";

const Login = z.object({ token: z.string() });
const Printers = z.array(z.object({ id: z.number().optional(), name: z.string(), printerURL: z.string() }));
const Test = z.object({}).passthrough();

export interface FdmConfig {
  url: string;
  user: string;
  password: string;
}

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

export class FdmMonster {
  private token: { value: string; at: number } | null = null;
  constructor(private readonly cfg: FdmConfig) {}

  get configured() {
    return Boolean(this.cfg.user && this.cfg.password);
  }

  health() {
    return fetchJson(`${this.cfg.url}/api/v2/test`, Test);
  }

  private async auth(): Promise<string | null> {
    if (this.token && Date.now() - this.token.at < 5 * 60_000) return this.token.value;
    const res = await fetchJson(`${this.cfg.url}/api/v2/auth/login`, Login, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: this.cfg.user, password: this.cfg.password }),
    });
    if (!res.ok) return null;
    this.token = { value: res.data.token, at: Date.now() };
    return this.token.value;
  }

  async registered(): Promise<{ ok: true; urls: Map<string, string> } | { ok: false; error: string }> {
    if (!this.configured) return { ok: false, error: "not_configured" };
    const token = await this.auth();
    if (!token) return { ok: false, error: "auth_failed" };
    const res = await fetchJson(`${this.cfg.url}/api/v2/printer`, Printers, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, urls: new Map(res.data.map((p) => [norm(p.printerURL), p.name])) };
  }

  async register(
    name: string,
    printerUrl: string,
  ): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
    const existing = await this.registered();
    if (!existing.ok) return existing;
    if (existing.urls.has(norm(printerUrl))) return { ok: true, already: true };
    const token = await this.auth();
    if (!token) return { ok: false, error: "auth_failed" };
    const res = await fetchJson(`${this.cfg.url}/api/v2/printer`, z.object({}).passthrough(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, printerURL: printerUrl, printerType: 1, apiKey: "", enabled: true }),
      timeoutMs: 15_000,
    });
    return res.ok ? { ok: true, already: false } : { ok: false, error: res.error };
  }
}
