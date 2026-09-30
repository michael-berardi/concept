/** API error with a code that names its cause (no silent failures). */
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 0) {
    super(`${code}: ${message}`);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface RequestOptions {
  json?: unknown;
  ifMatch?: string;
  query?: Record<string, string | number | undefined | null>;
}

export async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
  base = "",
): Promise<T> {
  const url = new URL(base + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;

  let res: Response;
  try {
    res = await fetch(url.pathname + url.search, {
      method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new ApiError("network_error", `request to ${path} failed: server unreachable`, 0);
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError("bad_response", `non-JSON response from ${path} (HTTP ${res.status})`, res.status);
    }
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      err?.code ?? `http_${res.status}`,
      err?.message ?? `request to ${path} failed with HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}
