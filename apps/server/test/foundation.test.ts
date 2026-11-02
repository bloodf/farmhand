import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfirmTokens } from "../src/lib/confirm-token.js";
import { sanitizeInput } from "../src/lib/operations.js";
import { harness, ORIGIN } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});
afterAll(() => h.close());

describe("setup", () => {
  it("reports needsSetup, creates exactly one admin, then refuses", async () => {
    expect(await (await h.client().get("/api/setup/status")).json()).toEqual({ needsSetup: true });
    const admin = await h.setup();
    expect(await (await admin.get("/api/setup/status")).json()).toEqual({ needsSetup: false });
    const again = await h
      .client()
      .post("/api/setup", { name: "x", email: "x@example.com", password: "another-long-password" });
    expect(again.status).toBe(410);
    const signup = await h.client().post("/api/auth/sign-up/email", {
      name: "x",
      email: "x@example.com",
      password: "another-long-password",
    });
    expect(signup.status).toBeGreaterThanOrEqual(400);
    const me = (await (await admin.get("/api/auth/get-session")).json()) as { user: { role: string } };
    expect(me.user.role).toBe("admin");
  });
});

describe("auth gates", () => {
  it("rejects anonymous, viewer and operator on admin routes, allows admin", async () => {
    expect((await h.client().get("/api/settings")).status).toBe(401);
    const viewer = await h.userWithRole("viewer");
    const operator = await h.userWithRole("operator");
    expect((await viewer.get("/api/settings")).status).toBe(200);
    expect((await viewer.patch("/api/settings", { lowStockGrams: 1 })).status).toBe(403);
    expect((await operator.patch("/api/settings", { lowStockGrams: 1 })).status).toBe(403);
    expect((await viewer.get("/api/settings/integrations")).status).toBe(403);
    const ok = await h.admin.patch("/api/settings", { lowStockGrams: 150 });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { lowStockGrams: number }).lowStockGrams).toBe(150);
  });

  it("rejects a foreign Origin on writes (CSRF)", async () => {
    const res = await h.admin.patch(
      "/api/settings",
      { lowStockGrams: 2 },
      { origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
  });

  it("rejects unknown fields and unknown interfaces", async () => {
    expect((await h.admin.patch("/api/settings", { nope: 1 })).status).toBe(400);
    expect((await h.admin.patch("/api/settings", { lanIfaces: ["nope0"] })).status).toBe(422);
    const noOrigin = await h.app.request("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: h.admin.cookie() },
      body: JSON.stringify({ lowStockGrams: 3 }),
    });
    expect(noOrigin.status).toBe(403);
  });

  it("never returns secret values from integrations", async () => {
    const body = await (await h.admin.get("/api/settings/integrations")).text();
    expect(body).not.toContain("PASSWORD");
    expect(JSON.parse(body).printstash.credentials).toBe(false);
  });
});

describe("operations", () => {
  it("records settings changes without secrets and lists newest first", async () => {
    const res = (await (await h.admin.get("/api/operations?kind=settings")).json()) as {
      items: { input: Record<string, unknown>; status: string }[];
    };
    expect(res.items.length).toBeGreaterThanOrEqual(1);
    expect(res.items[0]?.status).toBe("complete");
    expect(sanitizeInput({ ip: "1.2.3.4", password: "x", apiKey: "y", authorization: "z" })).toEqual({
      ip: "1.2.3.4",
    });
  });

  it("marks running rows as unknown on boot", async () => {
    const id = await h.deps.operations.open("restart", null, "spoolman", {});
    await h.deps.operations.closeStale();
    expect((await h.deps.operations.get(id))?.status).toBe("unknown");
  });

  it("404s on a missing id", async () => {
    expect((await h.admin.get("/api/operations/nope")).status).toBe(404);
  });
});

describe("confirm tokens", () => {
  const t = new ConfirmTokens("test-secret-test-secret-test-secret-0000");
  const input = { ip: "10.0.0.5", port: 7125 };
  it("round-trips once and refuses replay", () => {
    const { token } = t.mint("approve", input, "u1");
    expect(t.redeem(token, "approve", { port: 7125, ip: "10.0.0.5" }, "u1").ok).toBe(true);
    expect(t.redeem(token, "approve", input, "u1")).toMatchObject({ ok: false, code: "replayed" });
  });
  it("binds to input, user and action", () => {
    const { token } = t.mint("approve", input, "u1");
    expect(t.redeem(token, "approve", { ip: "10.0.0.6", port: 7125 }, "u1")).toMatchObject({
      code: "mismatch",
    });
    expect(t.redeem(token, "approve", input, "u2")).toMatchObject({ code: "mismatch" });
    expect(t.redeem(token, "repair", input, "u1")).toMatchObject({ code: "mismatch" });
  });
  it("expires and rejects tampering", () => {
    const { token } = t.mint("approve", input, "u1", 0);
    expect(t.redeem(token, "approve", input, "u1")).toMatchObject({ code: "expired" });
    const [body] = token.split(".");
    expect(t.redeem(`${body}.AAAA`, "approve", input, "u1")).toMatchObject({ code: "bad_signature" });
    expect(t.redeem("garbage", "approve", input, "u1")).toMatchObject({ code: "malformed" });
  });
});

describe("docs", () => {
  it("serves openapi and gates scalar", async () => {
    expect((await h.client().get("/api/openapi.json")).status).toBe(401);
    const spec = (await (await h.admin.get("/api/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/api/health", "/api/setup", "/api/settings", "/api/operations"]),
    );
    expect((await h.client().get("/api/docs")).status).toBe(401);
    expect((await h.admin.get("/api/docs")).status).toBe(200);
  });
  it("health is public", async () => {
    expect((await h.client().get("/api/health", { origin: ORIGIN })).status).toBe(200);
  });
});
