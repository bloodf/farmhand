/** Single source of configuration. Parsed once at boot; anything missing fails fast. */
import { parseBridgeTargets } from "@farmhand/contracts";
import { z } from "zod";

const url = z.string().url();
const flag = z
  .enum(["", "0", "1", "false", "true"])
  .default("")
  .transform((v) => v === "1" || v === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FARMHAND_PORT: z.coerce.number().int().min(1).max(65535).default(3490),
  /** Addresses to listen on, comma separated. */
  FARMHAND_HOST: z.string().default("127.0.0.1"),
  /** Origin the browser uses. Drives CSRF and cookie flags. */
  FARMHAND_PUBLIC_URL: url.default("http://localhost:5173"),
  /** Extra origins the UI is also served from (comma separated), e.g. a Tailscale name next to the LAN address. */
  FARMHAND_TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(url)),
  FARMHAND_DB: z.string().default("./farmhand.db"),
  /** 32+ random bytes. `openssl rand -base64 48`. */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Development only: lets fixtures on 127.0.0.0/8 count as printers. */
  FARMHAND_DEV_ALLOW_LOOPBACK: flag,
  /** Moonraker bridges on this host, `ip:port` comma list. Only an exact match may use this host's own address. */
  FARMHAND_BRIDGE_TARGETS: z
    .string()
    .default("")
    .transform((v, ctx) => {
      const list = parseBridgeTargets(v);
      if (!list) ctx.addIssue({ code: "custom", message: "expected a comma list of ipv4:port" });
      return list ?? [];
    }),
  /** No login: every request acts as an admin. Only when every machine that can reach farmhand is trusted. */
  FARMHAND_OPEN_ACCESS: flag,
  /** Header the reverse proxy sets with the real client address (it must overwrite it). */
  FARMHAND_TRUSTED_IP_HEADER: z.string().default("x-real-ip"),
  /** Path to the web build to serve in production; empty = API only. */
  FARMHAND_WEB_DIST: z.string().default(""),
  /** Address on the printers' LAN that Spoolman is reachable on (used in snippets). */
  FARMHAND_LAN_IP: z.string().default(""),
  FARMHAND_LAN_IFACES: z.string().default("br0"),
  /** Unix socket of farmhand-helper, or "fake" for development. */
  FARMHAND_HELPER: z.string().default("fake"),
  FARMHAND_FAKE_HELPER_DIR: z.string().default(""),

  PRINTSTASH_URL: url.default("http://127.0.0.1:3460"),
  PRINTSTASH_USER: z.string().default(""),
  PRINTSTASH_PASSWORD: z.string().default(""),
  PRINTSTASH_PUBLIC_URL: z.string().default(""),
  FDM_URL: url.default("http://127.0.0.1:4000"),
  FDM_USER: z.string().default(""),
  FDM_PASSWORD: z.string().default(""),
  FDM_PUBLIC_URL: z.string().default(""),
  SPOOLMAN_URL: url.default("http://127.0.0.1:7912"),
  SPOOLMAN_PUBLIC_URL: z.string().default(""),
  ORCASLICER_URL: url.default("http://127.0.0.1:3470"),
  ORCASLICER_PUBLIC_URL: z.string().default(""),
  MAINSAIL_URL: url.default("http://127.0.0.1:3480"),
  MAINSAIL_PUBLIC_URL: z.string().default(""),
  HA_URL: z.string().default(""),
  HA_DISCOVERY_WEBHOOK: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(source);
  if (env.NODE_ENV === "production" && env.FARMHAND_DEV_ALLOW_LOOPBACK) {
    throw new Error("FARMHAND_DEV_ALLOW_LOOPBACK is not allowed in production");
  }
  if (env.NODE_ENV === "production" && env.FARMHAND_HELPER === "fake") {
    throw new Error("FARMHAND_HELPER must point at the helper socket in production");
  }
  return env;
}

export const testEnv = (over: Partial<Env> = {}): Env =>
  loadEnv({
    NODE_ENV: "test",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
    FARMHAND_DB: ":memory:",
    FARMHAND_DEV_ALLOW_LOOPBACK: "1",
    ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])),
  });
