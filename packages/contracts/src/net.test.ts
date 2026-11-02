import { describe, expect, it } from "vitest";
import { nameProblem } from "./names.js";
import { checkTarget, forbiddenClass, type Ipv4Net, parseIpv4 } from "./net.js";

// 10.25.16.0/24 on br0 (host is .41), 192.168.50.0/24 on eth1, tailscale /32 on ts0
const ip = (s: string) => {
  const p = parseIpv4(s);
  if (!p) throw new Error(s);
  return (((p[0] ?? 0) << 24) | ((p[1] ?? 0) << 16) | ((p[2] ?? 0) << 8) | (p[3] ?? 0)) >>> 0;
};
const nets: Ipv4Net[] = [
  { iface: "br0", address: ip("10.25.16.41"), prefix: 24 },
  { iface: "eth1", address: ip("192.168.50.2"), prefix: 24 },
  { iface: "ts0", address: ip("100.96.201.33"), prefix: 32 },
];
const lan = { lan: true, lanIfaces: ["br0"], nets } as const;
const any = { lan: false, lanIfaces: [], nets } as const;

describe("parseIpv4", () => {
  it.each(["10.0.0.1", "0.0.0.0", "255.255.255.255"])("accepts %s", (s) =>
    expect(parseIpv4(s)).not.toBeNull(),
  );
  it.each([
    "256.1.1.1",
    "01.2.3.4",
    "1.2.3",
    "1.2.3.4.5",
    "printer.local",
    "http://1.2.3.4",
    " 1.2.3.4",
    "1.2.3.4\n",
  ])("rejects %s", (s) => expect(parseIpv4(s)).toBeNull());
});

describe("forbiddenClass", () => {
  it.each([
    ["0.1.2.3", "unspecified"],
    ["127.0.0.2", "loopback"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    ["169.254.1.1", "link_local"],
    ["100.96.201.33", "shared"],
    ["100.127.255.1", "shared"],
    ["198.18.0.5", "benchmark"],
    ["192.0.0.9", "reserved"],
  ])("%s is %s", (s, cls) => expect(forbiddenClass(parseIpv4(s) ?? [])).toBe(cls));
  it("allows ordinary unicast", () => {
    expect(forbiddenClass([10, 0, 0, 5])).toBeNull();
    expect(forbiddenClass([100, 63, 0, 1])).toBeNull();
    expect(forbiddenClass([192, 0, 1, 1])).toBeNull();
  });
});

describe("checkTarget", () => {
  it("accepts a LAN host", () =>
    expect(checkTarget("10.25.16.50", lan)).toEqual({ ok: true, ip: "10.25.16.50" }));
  it("rejects the host's own address on any interface", () => {
    expect(checkTarget("10.25.16.41", lan)).toEqual({ ok: false, code: "own_address" });
    expect(checkTarget("192.168.50.2", any)).toEqual({ ok: false, code: "own_address" });
  });
  it("rejects network and broadcast addresses", () => {
    expect(checkTarget("10.25.16.0", lan)).toEqual({ ok: false, code: "network_or_broadcast" });
    expect(checkTarget("10.25.16.255", lan)).toEqual({ ok: false, code: "network_or_broadcast" });
  });
  it("rejects addresses outside the allowed interfaces", () => {
    expect(checkTarget("192.168.50.10", lan)).toEqual({ ok: false, code: "outside_lan" });
    expect(checkTarget("8.8.8.8", lan)).toEqual({ ok: false, code: "outside_lan" });
  });
  it("allows a public address only when lan is off", () =>
    expect(checkTarget("8.8.8.8", any)).toEqual({ ok: true, ip: "8.8.8.8" }));
  it("rejects loopback unless explicitly allowed", () => {
    expect(checkTarget("127.0.0.1", any)).toEqual({ ok: false, code: "loopback" });
    expect(checkTarget("127.0.0.1", { ...any, allowLoopback: true })).toEqual({ ok: true, ip: "127.0.0.1" });
  });
  it("allowLoopback does not open other classes", () =>
    expect(checkTarget("169.254.1.1", { ...any, allowLoopback: true })).toEqual({
      ok: false,
      code: "link_local",
    }));
  it("rejects junk", () =>
    expect(checkTarget("printer.local", lan)).toEqual({ ok: false, code: "invalid_ipv4" }));
});

describe("nameProblem", () => {
  it("accepts a plain name", () => expect(nameProblem("Voron 2.4 #1")).toBeNull());
  it("rejects empty and too long", () => {
    expect(nameProblem("")).toBe("length");
    expect(nameProblem("x".repeat(81))).toBe("length");
  });
  it("rejects surrounding whitespace", () => expect(nameProblem(" a")).toBe("whitespace"));
  it.each(["a]b", "[printer x", "line\nbreak", "tab\there", "nul\u0000"])("rejects %j", (s) =>
    expect(nameProblem(s)).toBe("forbidden_chars"),
  );
});
