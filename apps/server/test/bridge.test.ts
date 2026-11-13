import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeApps, createFakeMoonraker, FIXTURE_PASSWORD, FIXTURE_USER } from "@farmhand/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// A Moonraker bridge on this host: listed in FARMHAND_BRIDGE_TARGETS, so the Spoolman allowlist step is left out.
const P = { bridge: 28127, printstash: 28461, fdm: 28401, spoolman: 28913 };
const mr = createFakeMoonraker({ name: "kobra", port: P.bridge, state: "standby", tickMs: 0 });
const apps = createFakeApps({ printstashPort: P.printstash, fdmPort: P.fdm, spoolmanPort: P.spoolman });
const dir = mkdtempSync(join(tmpdir(), "farmhand-bridge-"));

let h: Awaited<ReturnType<typeof harness>>;

beforeAll(async () => {
  mr.start();
  apps.start();
  h = await harness({
    PRINTSTASH_URL: `http://127.0.0.1:${P.printstash}`,
    PRINTSTASH_USER: FIXTURE_USER,
    PRINTSTASH_PASSWORD: FIXTURE_PASSWORD,
    FDM_URL: `http://127.0.0.1:${P.fdm}`,
    FDM_USER: FIXTURE_USER,
    FDM_PASSWORD: FIXTURE_PASSWORD,
    SPOOLMAN_URL: `http://127.0.0.1:${P.spoolman}`,
    FARMHAND_FAKE_HELPER_DIR: dir,
    FARMHAND_BRIDGE_TARGETS: [`127.0.0.1:${P.bridge}`],
  });
  await h.setup();
});
afterAll(async () => {
  await h.close();
  await Promise.all([mr.stop(), apps.stop()]);
});

const j = async <T>(r: Response) => (await r.json()) as T;

describe("bridge target", () => {
  it("previews and approves without touching the Spoolman allowlist", async () => {
    const op = await h.userWithRole("operator");
    const pre = await j<{ confirmToken: string; effects: { id: string }[] }>(
      await op.post("/api/approvals/preview", { ip: "127.0.0.1", port: P.bridge }),
    );
    expect(pre.effects.map((e) => e.id)).toEqual(["printstash", "fdm", "mobileraker"]);
    const r = await j<{ steps: { id: string; status: string; message: string }[] }>(
      await op.post("/api/approvals", {
        confirmToken: pre.confirmToken,
        host: "127.0.0.1",
        port: P.bridge,
        name: "kobra",
      }),
    );
    expect(r.steps).toEqual([
      { id: "allowlist", status: "skipped", message: "bridge" },
      { id: "printstash", status: "success", message: "" },
      { id: "fdm", status: "success", message: "" },
      { id: "mobileraker", status: "success", message: "" },
    ]);
    expect(() => readFileSync(join(dir, "printers.allow"), "utf8")).toThrow();
    expect(readFileSync(join(dir, "mobileraker.conf"), "utf8")).toContain(
      `ws://127.0.0.1:${P.bridge}/websocket`,
    );
  });
});

describe("FARMHAND_BRIDGE_TARGETS", () => {
  it("refuses a malformed list at startup", async () => {
    const { loadEnv } = await import("../src/env.js");
    const base = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "x".repeat(40),
      FARMHAND_HELPER: "/run/h.sock",
    };
    expect(() => loadEnv({ ...base, FARMHAND_BRIDGE_TARGETS: "10.25.16.41" })).toThrow();
    expect(loadEnv({ ...base, FARMHAND_BRIDGE_TARGETS: "10.25.16.41:7125" }).FARMHAND_BRIDGE_TARGETS).toEqual(
      ["10.25.16.41:7125"],
    );
  });
});
