import type { ErrorBody } from "@contracts/common";

import { config } from "@/config";

/** Thrown for every non-2xx response (and for network failures, with status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * The session bridge: AuthContext registers how to read the current JWT and what to do on a 401.
 * Keeping it here (instead of passing the token to every hook) keeps screens free of auth plumbing.
 */
const session: { getToken: () => string | null; onUnauthorized: () => void } = {
  getToken: () => null,
  onUnauthorized: () => {},
};

export function configureApiSession(handlers: Partial<typeof session>) {
  Object.assign(session, handlers);
}

function buildUrl(path: string, query?: ApiOptions["query"]) {
  const url = `${config.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return params.length ? `${url}?${params.join("&")}` : url;
}

/**
 * All server calls go through here: base URL, Bearer token, JSON body, and error parsing.
 * `{error:{code,message}}` bodies become a thrown ApiError. A 401 clears the session.
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, query, headers = {}, signal } = opts;
  const token = session.getToken();
  const finalHeaders: Record<string, string> = { Accept: "application/json", ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    const err = (json as Partial<ErrorBody> | undefined)?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
    if (res.status === 401 && token) session.onUnauthorized();
    throw apiError;
  }
  return json as T;
}

/** Errors worth retrying: network failures and 5xx except "not configured" (retrying won't help). */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 0) return true;
  if (error.code === "NOT_CONFIGURED") return false;
  return error.status >= 500 || error.status === 408;
}

/** A short, human message for an error, used by toasts and error states. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "RATE_LIMITED":
        return "Too many requests. Please wait a bit and try again.";
      case "NOT_CONFIGURED":
        return "This feature isn't set up on the server yet.";
      case "AI_UNAVAILABLE":
      case "AI_BAD_OUTPUT":
        return "The AI helper is unavailable right now. The rest of the app keeps working.";
      case "AI_REFUSED":
        return "The AI helper couldn't answer that request.";
      default:
        if (error.status === 429) return "Too many requests. Please wait a bit and try again.";
        return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
