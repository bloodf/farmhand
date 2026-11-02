/** PrintStash 0.15.x: login, list printers, register a Moonraker printer. */
import { z } from "zod";
import { fetchJson } from "./http.js";

const Login = z.object({ access_token: z.string() });
const Printers = z.array(
  z.object({ id: z.number().optional(), name: z.string(), moonraker_url: z.string().nullable().optional() }),
);
const Health = z.object({}).passthrough();

export interface PrintStashConfig {
  url: string;
  user: string;
  password: string;
}

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

export class PrintStash {
  private token: { value: string; at: number } | null = null;
  constructor(private readonly cfg: PrintStashConfig) {}

  get configured() {
    return Boolean(this.cfg.user && this.cfg.password);
  }

  health() {
    return fetchJson(`${this.cfg.url}/api/v1/health`, Health);
  }

  private async auth(): Promise<string | null> {
    if (this.token && Date.now() - this.token.at < 5 * 60_000) return this.token.value;
    const res = await fetchJson(`${this.cfg.url}/api/v1/auth/login`, Login, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: this.cfg.user, password: this.cfg.password }),
    });
    if (!res.ok) return null;
    this.token = { value: res.data.access_token, at: Date.now() };
    return this.token.value;
  }

  /** Moonraker URLs currently registered, normalized. */
  async registered(): Promise<{ ok: true; urls: Map<string, string> } | { ok: false; error: string }> {
    if (!this.configured) return { ok: false, error: "not_configured" };
    const token = await this.auth();
    if (!token) return { ok: false, error: "auth_failed" };
    const res = await fetchJson(`${this.cfg.url}/api/v1/printers`, Printers, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      urls: new Map(
        res.data.filter((p) => p.moonraker_url).map((p) => [norm(p.moonraker_url as string), p.name]),
      ),
    };
  }

  async register(
    name: string,
    moonrakerUrl: string,
  ): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
    const existing = await this.registered();
    if (!existing.ok) return existing;
    if (existing.urls.has(norm(moonrakerUrl))) return { ok: true, already: true };
    const token = await this.auth();
    if (!token) return { ok: false, error: "auth_failed" };
    const res = await fetchJson(`${this.cfg.url}/api/v1/printers`, z.object({}).passthrough(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, provider: "moonraker", moonraker_url: moonrakerUrl }),
      timeoutMs: 10_000,
    });
    return res.ok ? { ok: true, already: false } : { ok: false, error: res.error };
  }
}
