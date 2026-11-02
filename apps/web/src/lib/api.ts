/** Tiny JSON client. Every request is same-origin with cookies; bodies are always JSON. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(code);
  }
}

export async function fetchJson<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers:
      init.json === undefined ? { accept: "application/json" } : { "content-type": "application/json" },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = (body as { code?: unknown } | null)?.code;
    throw new ApiError(res.status, typeof code === "string" ? code : `http_${res.status}`, body);
  }
  return body as T;
}
