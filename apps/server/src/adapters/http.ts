/** Outbound HTTP with a hard timeout, no redirects, a body cap and zod parsing. Errors never echo bodies. */
import type { z } from "zod";

export const SOURCE_TIMEOUT_MS = 3000;
const MAX_BODY = 1024 * 1024;

export type Fetched<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Fetched<T>> {
  const started = Date.now();
  const latency = () => Date.now() - started;
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(init.timeoutMs ?? SOURCE_TIMEOUT_MS),
      headers: { accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, latencyMs: latency() };
    const text = await readCapped(res, MAX_BODY);
    if (text === null) return { ok: false, error: "body_too_large", latencyMs: latency() };
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, error: "unexpected_response", latencyMs: latency() };
    return { ok: true, data: parsed.data, latencyMs: latency() };
  } catch (err) {
    return { ok: false, error: classify(err), latencyMs: latency() };
  }
}

/** Reads at most `max` bytes; returns null (and cancels the stream) when the body is bigger. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max || !res.body) {
    await res.body?.cancel();
    return declared > max ? null : "";
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function classify(err: unknown): string {
  if (err instanceof SyntaxError) return "not_json";
  const name = (err as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code ?? (err as { code?: string })?.code;
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "unreachable";
  if (code) return code.toLowerCase();
  return "network";
}
