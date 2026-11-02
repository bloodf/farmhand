/**
 * Printer target validation. Real IPv4 only (no hostname or URL), never
 * loopback, unspecified, multicast, reserved, broadcast or link-local, never an
 * address this host owns, and — when `lan` is set — inside a network attached
 * to one of the allowed interfaces. The root helper repeats these checks; this
 * copy exists so the UI can refuse early and the server can refuse before the
 * helper is involved.
 */
import { networkInterfaces } from "node:os";

export const IPV4_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;

export function parseIpv4(raw: string): number[] | null {
  if (!IPV4_PATTERN.test(raw)) return null;
  const parts = raw.split(".").map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

const toInt = (p: number[]): number =>
  (((p[0] ?? 0) << 24) | ((p[1] ?? 0) << 16) | ((p[2] ?? 0) << 8) | (p[3] ?? 0)) >>> 0;

export type ForbiddenClass = "unspecified" | "loopback" | "multicast" | "reserved" | "link_local";

export function forbiddenClass(parts: number[]): ForbiddenClass | null {
  const [a, b] = parts;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a !== undefined && a >= 224 && a <= 239) return "multicast";
  if (a !== undefined && a >= 240) return "reserved";
  if (a === 169 && b === 254) return "link_local";
  return null;
}

export interface Ipv4Net {
  iface: string;
  address: number;
  prefix: number;
}

/** Host interfaces as numeric networks. Exposed so tests can pass a fixed list. */
export function hostNets(): Ipv4Net[] {
  const out: Ipv4Net[] = [];
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== "IPv4") continue;
      const parts = parseIpv4(entry.address);
      const mask = parseIpv4(entry.netmask);
      if (!parts || !mask) continue;
      const prefix = toInt(mask).toString(2).replace(/0/g, "").length;
      out.push({ iface, address: toInt(parts), prefix });
    }
  }
  return out;
}

const inNet = (addr: number, net: Ipv4Net): boolean => {
  const mask = net.prefix === 0 ? 0 : (0xffffffff << (32 - net.prefix)) >>> 0;
  return (addr & mask) >>> 0 === (net.address & mask) >>> 0;
};

export type TargetRejection =
  | "invalid_ipv4"
  | ForbiddenClass
  | "own_address"
  | "outside_lan"
  | "network_or_broadcast";

export type TargetCheck = { ok: true; ip: string } | { ok: false; code: TargetRejection };

export interface TargetOptions {
  /** Require the address to sit inside a network attached to one of `lanIfaces`. */
  lan: boolean;
  lanIfaces: readonly string[];
  /** Development only: lets fixtures on 127.0.0.0/8 pass. Production refuses this flag. */
  allowLoopback?: boolean;
  /** Test seam; defaults to this host's interfaces. */
  nets?: readonly Ipv4Net[];
}

export function checkTarget(raw: string, opts: TargetOptions): TargetCheck {
  const parts = parseIpv4(raw);
  if (!parts) return { ok: false, code: "invalid_ipv4" };
  const bad = forbiddenClass(parts);
  if (bad === "loopback" && opts.allowLoopback) return { ok: true, ip: parts.join(".") };
  if (bad) return { ok: false, code: bad };
  const addr = toInt(parts);
  const nets = opts.nets ?? hostNets();
  if (nets.some((n) => n.address === addr)) return { ok: false, code: "own_address" };
  if (opts.lan) {
    const net = nets.filter((n) => opts.lanIfaces.includes(n.iface)).find((n) => inNet(addr, n));
    if (!net) return { ok: false, code: "outside_lan" };
    if (net.prefix < 31) {
      const hostBits = 32 - net.prefix;
      const size = 2 ** hostBits;
      const offset = addr % size;
      if (offset === 0 || offset === size - 1) return { ok: false, code: "network_or_broadcast" };
    }
  }
  return { ok: true, ip: parts.join(".") };
}

export const PORT_MIN = 1;
export const PORT_MAX = 65535;
export const DEFAULT_MOONRAKER_PORT = 7125;

export const isValidPort = (n: number): boolean => Number.isInteger(n) && n >= PORT_MIN && n <= PORT_MAX;
