/** In-memory app + cookie jar per test file. */
import { createApp } from "../src/app.js";
import { type CreateDepsOptions, createDeps, type Deps } from "../src/deps.js";
import { type Env, testEnv } from "../src/env.js";
import { resetRateLimitsForTests } from "../src/middleware/rate-limit.js";

export const ORIGIN = "http://localhost:5173";
const silent = { info() {}, warn() {}, error() {} };

export async function harness(
  over: Partial<Env> = {},
  opts: { jobs?: boolean; discovery?: CreateDepsOptions["discovery"] } = {},
) {
  resetRateLimitsForTests();
  const deps = await createDeps(testEnv({ FARMHAND_PUBLIC_URL: ORIGIN, ...over }), {
    log: silent,
    version: "test",
    jobs: opts.jobs,
    discovery: opts.discovery,
  });
  const { app } = createApp(deps);

  const client = () => {
    const jar = new Map<string, string>();
    let cookie = "";
    const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
      const res = await app.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(method !== "GET" ? { origin: ORIGIN } : {}),
          ...(cookie ? { cookie } : {}),
          ...extra,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const s of res.headers.getSetCookie()) {
        const [pair] = s.split(";");
        const eq = pair?.indexOf("=") ?? -1;
        if (!pair || eq < 0) continue;
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (value === "" || /max-age=0/i.test(s)) jar.delete(name);
        else jar.set(name, value);
      }
      cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      return res;
    };
    return {
      get: (p: string, h?: Record<string, string>) => call("GET", p, undefined, h),
      post: (p: string, b?: unknown, h?: Record<string, string>) => call("POST", p, b ?? {}, h),
      patch: (p: string, b: unknown, h?: Record<string, string>) => call("PATCH", p, b, h),
      cookie: () => cookie,
    };
  };

  const admin = client();
  const setup = async () => {
    const res = await admin.post("/api/setup", {
      name: "Admin",
      email: "admin@example.com",
      password: "correct-horse-battery",
    });
    if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
    return admin;
  };

  /** Creates a user with `role` through the admin plugin and returns a signed-in client. */
  const userWithRole = async (role: "viewer" | "operator" | "admin", email = `${role}@example.com`) => {
    const res = await admin.post("/api/auth/admin/create-user", {
      email,
      password: "another-long-password",
      name: role,
      role,
    });
    if (res.status !== 200) throw new Error(`create-user failed: ${res.status} ${await res.text()}`);
    const c = client();
    const login = await c.post("/api/auth/sign-in/email", { email, password: "another-long-password" });
    if (login.status !== 200) throw new Error(`sign-in failed: ${login.status} ${await login.text()}`);
    return c;
  };

  return { app, deps: deps as Deps, client, admin, setup, userWithRole, close: deps.close };
}
