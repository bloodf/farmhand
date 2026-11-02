import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeApps, FIXTURE_PASSWORD, FIXTURE_USER } from "./apps.js";
import { createFakeMoonraker } from "./moonraker.js";

const mr = createFakeMoonraker({
  name: "t1",
  port: 27125,
  state: "printing",
  filename: "a.gcode",
  tickMs: 0,
});
const apps = createFakeApps({ printstashPort: 23460, fdmPort: 24000, spoolmanPort: 27912 });

beforeAll(() => {
  mr.start();
  apps.start();
});
afterAll(async () => {
  await mr.stop();
  await apps.stop();
});

const json = async (url: string, init?: RequestInit) => (await fetch(url, init)).json();
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("fake moonraker", () => {
  it("answers HTTP info endpoints", async () => {
    const info = (await json("http://127.0.0.1:27125/server/info")) as { result: { klippy_state: string } };
    expect(info.result.klippy_state).toBe("ready");
  });

  it("subscribes over websocket and pushes updates on tick", async () => {
    const ws = new WebSocket("ws://127.0.0.1:27125/websocket");
    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws failed"));
    });
    ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "printer.objects.subscribe",
        params: { objects: { print_stats: null, virtual_sdcard: null } },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    mr.tick();
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    const sub = frames[0] as { result: { status: { print_stats: { state: string } } } };
    expect(sub.result.status.print_stats.state).toBe("printing");
    const upd = frames[1] as { method: string; params: [{ virtual_sdcard: { progress: number } }] };
    expect(upd.method).toBe("notify_status_update");
    expect(upd.params[0].virtual_sdcard.progress).toBeCloseTo(0.01);
  });

  it("goes offline on control", async () => {
    mr.setOffline(true);
    expect((await fetch("http://127.0.0.1:27125/server/info")).status).toBe(503);
    mr.setOffline(false);
  });
});

describe("fake apps", () => {
  it("printstash login + register", async () => {
    const login = (await (
      await post("http://127.0.0.1:23460/api/v1/auth/login", {
        username: FIXTURE_USER,
        password: FIXTURE_PASSWORD,
      })
    ).json()) as { access_token: string };
    const auth = { authorization: `Bearer ${login.access_token}` };
    expect(
      (
        await post(
          "http://127.0.0.1:23460/api/v1/printers",
          { name: "t1", provider: "moonraker", moonraker_url: "http://127.0.0.1:27125" },
          auth,
        )
      ).status,
    ).toBe(201);
    const list = (await json("http://127.0.0.1:23460/api/v1/printers", { headers: auth })) as {
      moonraker_url: string;
    }[];
    expect(list.map((p) => p.moonraker_url)).toEqual(["http://127.0.0.1:27125"]);
  });

  it("fdm probes the printer and honours the fail switch", async () => {
    const login = (await (
      await post("http://127.0.0.1:24000/api/v2/auth/login", {
        username: FIXTURE_USER,
        password: FIXTURE_PASSWORD,
      })
    ).json()) as { token: string };
    const auth = { authorization: `Bearer ${login.token}` };
    const body = {
      name: "t1",
      printerURL: "http://127.0.0.1:27125",
      printerType: 1,
      apiKey: "",
      enabled: true,
    };
    expect(
      (
        await post(
          "http://127.0.0.1:24000/api/v2/printer",
          { ...body, printerURL: "http://127.0.0.1:1" },
          auth,
        )
      ).status,
    ).toBe(502);
    apps.state.fdmFail = true;
    expect((await post("http://127.0.0.1:24000/api/v2/printer", body, auth)).status).toBe(502);
    apps.state.fdmFail = false;
    expect((await post("http://127.0.0.1:24000/api/v2/printer", body, auth)).status).toBe(201);
  });

  it("spoolman lists spools and can go down", async () => {
    const spools = (await json("http://127.0.0.1:27912/api/v1/spool")) as unknown[];
    expect(spools).toHaveLength(5);
    apps.state.spoolmanDown = true;
    expect((await fetch("http://127.0.0.1:27912/api/v1/health")).status).toBe(503);
    apps.state.spoolmanDown = false;
  });
});
