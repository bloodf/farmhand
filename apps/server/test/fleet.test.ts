import { createFakeApps, createFakeMoonraker, FIXTURE_PASSWORD, FIXTURE_USER } from "@farmhand/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

const P = { mr1: 27125, mr2: 27126, printstash: 23460, fdm: 24000, spoolman: 27912 };
const mr1 = createFakeMoonraker({
  name: "alpha",
  port: P.mr1,
  state: "printing",
  filename: "a.gcode",
  tickMs: 0,
});
const mr2 = createFakeMoonraker({ name: "beta", port: P.mr2, state: "standby", tickMs: 0 });
const apps = createFakeApps({ printstashPort: P.printstash, fdmPort: P.fdm, spoolmanPort: P.spoolman });

let h: Awaited<ReturnType<typeof harness>>;
const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return fn();
};

beforeAll(async () => {
  mr1.start();
  mr2.start();
  apps.start();
  // PrintStash already knows alpha; beta is unknown to everyone.
  apps.state.printstash.push({ name: "alpha", url: `http://127.0.0.1:${P.mr1}` });
  h = await harness(
    {
      PRINTSTASH_URL: `http://127.0.0.1:${P.printstash}`,
      PRINTSTASH_USER: FIXTURE_USER,
      PRINTSTASH_PASSWORD: FIXTURE_PASSWORD,
      FDM_URL: `http://127.0.0.1:${P.fdm}`,
      FDM_USER: FIXTURE_USER,
      FDM_PASSWORD: FIXTURE_PASSWORD,
      SPOOLMAN_URL: `http://127.0.0.1:${P.spoolman}`,
      ORCASLICER_URL: "http://127.0.0.1:1",
      MAINSAIL_URL: "http://127.0.0.1:1",
      FARMHAND_LAN_IP: "10.0.0.2",
      PRINTSTASH_PUBLIC_URL: "https://example.test:3460/",
    },
    { jobs: true },
  );
  await h.setup();
});
afterAll(async () => {
  await h.close();
  await Promise.all([mr1.stop(), mr2.stop(), apps.stop()]);
});

describe("adoption and live state", () => {
  it("adopts PrintStash printers at boot and streams their live state", async () => {
    const list = (await (await h.admin.get("/api/printers")).json()) as {
      items: {
        name: string;
        source: string;
        integrations: { printstash: { status: string } };
        live: { connection: string; state: string | null } | null;
      }[];
    };
    expect(list.items.map((p) => p.name)).toEqual(["alpha"]);
    expect(list.items[0]?.source).toBe("adopted");
    expect(list.items[0]?.integrations.printstash.status).toBe("already_configured");
    const id = [...h.deps.live.printers.keys()][0] ?? "";
    expect(await until(() => h.deps.live.printers.get(id)?.state === "printing")).toBe(true);
    const one = (await (await h.admin.get("/api/printers")).json()) as {
      items: { live: { state: string; filename: string; temps: { extruder?: { target: number } } } }[];
    };
    expect(one.items[0]?.live.state).toBe("printing");
    expect(one.items[0]?.live.filename).toBe("a.gcode");
    expect(one.items[0]?.live.temps.extruder?.target).toBe(215);
  });

  it("marks a printer offline when its socket drops and recovers after", async () => {
    const id = [...h.deps.live.printers.keys()][0] ?? "";
    mr1.setOffline(true);
    expect(await until(() => h.deps.live.printers.get(id)?.connection === "offline")).toBe(true);
    mr1.setOffline(false);
    expect(await until(() => h.deps.live.printers.get(id)?.connection === "online", 6000)).toBe(true);
  });

  it("overview counts, stock summary, and unavailable stock is never zero", async () => {
    const ov = (await (await h.admin.get("/api/overview")).json()) as {
      printers: { approved: number; printing: number; offline: number; pending: number };
      stock: {
        source: string;
        spools: number | null;
        knownGrams: number | null;
        spoolsWithoutWeight: number | null;
        lowStock: { id: number }[];
      };
      apps: { id: string; status: string }[];
    };
    expect(ov.printers).toEqual({ approved: 1, printing: 1, offline: 0, pending: 0 });
    expect(ov.stock.source).toBe("ok");
    expect(ov.stock.spools).toBe(4); // archived spool excluded
    expect(ov.stock.spoolsWithoutWeight).toBe(1);
    expect(ov.stock.knownGrams).toBe(1733);
    expect(ov.stock.lowStock.map((s) => s.id)).toEqual([2]);
    const byId = Object.fromEntries(ov.apps.map((a) => [a.id, a.status]));
    expect(byId).toMatchObject({
      spoolman: "up",
      printstash: "up",
      "fdm-monster": "up",
      orcaslicer: "down",
      mainsail: "down",
    });

    apps.state.spoolmanDown = true;
    await h.deps.fleet.refreshStock();
    const down = (await (await h.admin.get("/api/overview")).json()) as {
      stock: { source: string; spools: number | null; error: string };
    };
    expect(down.stock.source).toBe("unavailable");
    expect(down.stock.spools).toBeNull();
    expect(down.stock.error).toBe("http_503");
    apps.state.spoolmanDown = false;
  });

  it("apps expose public urls only when configured", async () => {
    const res = (await (await h.admin.get("/api/apps")).json()) as {
      items: { id: string; url: string | null }[];
    };
    expect(res.items.find((a) => a.id === "printstash")?.url).toBe("https://example.test:3460/");
    expect(res.items.find((a) => a.id === "spoolman")?.url).toBeNull();
  });

  it("snippets carry the spoolman block when a LAN IP is set", async () => {
    const id = [...h.deps.live.printers.keys()][0] ?? "";
    const s = (await (await h.admin.get(`/api/printers/${id}/snippets`)).json()) as {
      spoolmanConf: string;
      websocketUrl: string;
    };
    expect(s.spoolmanConf).toContain("server: http://10.0.0.2:7912");
    expect(s.websocketUrl).toBe(`ws://127.0.0.1:${P.mr1}/websocket`);
    expect((await h.admin.get("/api/printers/nope/snippets")).status).toBe(404);
  });

  it("SSE sends a snapshot first and then printer updates", async () => {
    const res = await h.app.request("/api/events", { headers: { cookie: h.admin.cookie() } });
    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    let buf = "";
    const read = async () => {
      const { value } = await reader.read();
      buf += dec.decode(value);
    };
    await read();
    expect(buf).toContain('"type":"snapshot"');
    mr1.tick();
    await until(() => buf.includes('"type":"printer"'), 2000);
    for (let i = 0; i < 5 && !buf.includes('"type":"printer"'); i++) await read();
    expect(buf).toContain('"type":"printer"');
    await reader.cancel();
  });

  it("viewer can read, anonymous cannot", async () => {
    expect((await h.client().get("/api/overview")).status).toBe(401);
    const viewer = await h.userWithRole("viewer");
    expect((await viewer.get("/api/overview")).status).toBe(200);
  });
});
