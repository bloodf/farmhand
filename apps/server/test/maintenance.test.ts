import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FakeHelper } from "../src/adapters/helper.js";
import { resetRateLimitsForTests } from "../src/middleware/rate-limit.js";
import { redact } from "../src/routes/maintenance.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
let op: Awaited<ReturnType<typeof h.userWithRole>>;
let helper: FakeHelper;

beforeAll(async () => {
  h = await harness({ FARMHAND_FAKE_HELPER_DIR: mkdtempSync(join(tmpdir(), "farmhand-maint-")) });
  await h.setup();
  op = await h.userWithRole("operator");
  helper = h.deps.helper as FakeHelper;
});
afterAll(() => h.close());
beforeEach(() => resetRateLimitsForTests());

const j = async <T>(r: Response) => (await r.json()) as T;

describe("services", () => {
  it("lists the six services with state text", async () => {
    const r = await j<{ items: { id: string; state: string }[]; helper: string }>(
      await op.get("/api/services"),
    );
    expect(r.items.map((s) => s.id)).toEqual([
      "spoolman",
      "printstash",
      "fdm-monster",
      "orcaslicer",
      "mainsail",
      "mobileraker",
    ]);
    expect(r.items.find((s) => s.id === "mobileraker")?.state).toBe("exited");
    expect(r.helper).toBe("fake");
  });

  it("restart needs confirm, operator role, a known id, and records an operation", async () => {
    expect((await op.post("/api/services/spoolman/restart", {})).status).toBe(400);
    expect((await op.post("/api/services/postgres/restart", { confirm: true })).status).toBe(400);
    const viewer = await h.userWithRole("viewer");
    expect((await viewer.post("/api/services/spoolman/restart", { confirm: true })).status).toBe(403);
    const r = await j<{ operationId: string; ready: boolean }>(
      await op.post("/api/services/spoolman/restart", { confirm: true }),
    );
    expect(r.ready).toBe(true);
    expect(helper.restarted).toEqual(["spoolman"]);
    expect(
      (await j<{ status: string; target: string }>(await op.get(`/api/operations/${r.operationId}`))).status,
    ).toBe("complete");
  });

  it("refuses to restart the companion with no printer configured", async () => {
    const res = await op.post("/api/services/mobileraker/restart", { confirm: true });
    expect(res.status).toBe(502);
    expect(await j(res)).toMatchObject({ code: "waiting" });
  });

  it("returns busy while the lock is held", async () => {
    const release = h.deps.lock.tryAcquire("x");
    expect((await op.post("/api/services/spoolman/restart", { confirm: true })).status).toBe(409);
    release?.();
  });
});

describe("logs", () => {
  it("only fixed sources, operator role, redacted", async () => {
    expect((await op.get("/api/logs/postgres")).status).toBe(400);
    const viewer = await h.userWithRole("viewer", "v2@example.com");
    expect((await viewer.get("/api/logs/spoolman")).status).toBe(403);
    const r = await j<{ lines: string[] }>(await op.get("/api/logs/spoolman"));
    expect(r.lines.every((l) => !/Bearer (?!\[redacted\])/.test(l))).toBe(true);
  });

  it("redact() strips the usual secrets", () => {
    const line = redact(
      "Authorization: Bearer abc.def.ghi password=hunter2 token: 'xyz' eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c http://user:pw@host/",
    );
    expect(line).toBe(
      "Authorization: Bearer [redacted] password=[redacted] token: '[redacted] [jwt] http://[redacted]@host/",
    );
  });
});

describe("backup", () => {
  it("admin only, confirm required, then status moves to inactive/success", async () => {
    expect((await op.post("/api/backups", { confirm: true })).status).toBe(403);
    expect((await h.admin.post("/api/backups", {})).status).toBe(400);
    resetRateLimitsForTests();
    const r = await h.admin.post("/api/backups", { confirm: true });
    expect(r.status).toBe(202);
    const first = await j<{ activeState: string }>(await op.get("/api/backups/status"));
    expect(first.activeState).toBe("active");
    await new Promise((res) => setTimeout(res, 300));
    const done = await j<{ activeState: string; result: string; finishedAt: string | null }>(
      await op.get("/api/backups/status"),
    );
    expect(done).toMatchObject({ activeState: "inactive", result: "success" });
    expect(done.finishedAt).not.toBeNull();
    // second start within the window is rate limited
    expect((await h.admin.post("/api/backups", { confirm: true })).status).toBe(429);
  });
});
