/**
 * Single-use token that binds a confirmed action to its exact input and user.
 * Preview mints it; the mutation redeems it. A token for printer A never
 * authorizes printer B, and a redeemed token never works twice.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 120_000;

export interface ConfirmPayload {
  action: string;
  input: Record<string, unknown>;
  userId: string;
  exp: number;
  nonce: string;
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : val,
  );

export class ConfirmTokens {
  private readonly key: Buffer;
  private readonly used = new Map<string, number>();

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync("sha256", secret, "farmhand", "confirm-token", 32));
  }

  mint(action: string, input: Record<string, unknown>, userId: string, now = Date.now()) {
    const payload: ConfirmPayload = {
      action,
      input,
      userId,
      exp: now + TTL_MS,
      nonce: randomBytes(12).toString("base64url"),
    };
    const body = Buffer.from(canonical(payload)).toString("base64url");
    return { token: `${body}.${this.sign(body)}`, expiresAt: new Date(payload.exp).toISOString() };
  }

  /** Returns the payload once; any later call with the same token fails. */
  redeem(token: string, action: string, input: Record<string, unknown>, userId: string, now = Date.now()) {
    const [body, sig] = token.split(".");
    if (!body || !sig) return { ok: false as const, code: "malformed" as const };
    const expected = this.sign(body);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: false as const, code: "bad_signature" as const };
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ConfirmPayload;
    if (payload.exp <= now) return { ok: false as const, code: "expired" as const };
    if (
      payload.action !== action ||
      payload.userId !== userId ||
      canonical(payload.input) !== canonical(input)
    ) {
      return { ok: false as const, code: "mismatch" as const };
    }
    if (this.used.has(payload.nonce)) return { ok: false as const, code: "replayed" as const };
    this.used.set(payload.nonce, payload.exp);
    for (const [n, exp] of this.used) if (exp <= now) this.used.delete(n);
    return { ok: true as const, payload };
  }

  private sign(body: string) {
    return createHmac("sha256", this.key).update(body).digest("base64url");
  }
}
