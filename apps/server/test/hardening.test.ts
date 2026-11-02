import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { fetchJson } from "../src/adapters/http.js";
import { applyStatus, emptyLive } from "../src/adapters/moonraker.js";

const app = new Hono();
app.get("/declared", (c) => c.body("x".repeat(10), 200, { "content-length": String(2 * 1024 * 1024) }));
app.get(
  "/stream",
  () =>
    new Response(
      new ReadableStream({
        start(ctrl) {
          const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
          for (let i = 0; i < 40; i++) ctrl.enqueue(chunk);
          ctrl.close();
        },
      }),
      { headers: { "content-type": "application/json" } },
    ),
);
app.get("/ok", (c) => c.json({ a: 1 }));
let server: ReturnType<typeof serve>;
beforeAll(() => {
  server = serve({ fetch: app.fetch, port: 48801, hostname: "127.0.0.1" });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("outbound body cap", () => {
  it("rejects an oversized declared length before reading", async () => {
    expect(await fetchJson("http://127.0.0.1:48801/declared", z.unknown())).toMatchObject({
      ok: false,
      error: "body_too_large",
    });
  });
  it("stops reading a stream past 1 MiB", async () => {
    expect(await fetchJson("http://127.0.0.1:48801/stream", z.unknown())).toMatchObject({
      ok: false,
      error: "body_too_large",
    });
  });
  it("still parses normal bodies", async () => {
    expect(await fetchJson("http://127.0.0.1:48801/ok", z.object({ a: z.number() }))).toMatchObject({
      ok: true,
      data: { a: 1 },
    });
  });
});

describe("moonraker status strings", () => {
  it("truncates filename and message from the printer", () => {
    const live = applyStatus(emptyLive("x"), {
      print_stats: { filename: "f".repeat(5000), state: "printing" },
      display_status: { message: "m".repeat(5000) },
    });
    expect(live.filename?.length).toBe(512);
    expect(live.message?.length).toBe(512);
  });
});
