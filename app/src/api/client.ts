import { config, isMockApi } from '@/config';

import { ApiError } from './errors';
import { mockRequest } from './mock/handler';

export { ApiError };

type AuthHandlers = {
  getToken: () => string | null;
  onUnauthorized: () => void;
};

let auth: AuthHandlers = { getToken: () => null, onUnauthorized: () => {} };

/** Called by AuthProvider so the client can read the JWT and clear the session on 401. */
export function setAuthHandlers(handlers: AuthHandlers) {
  auth = handlers;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  if (isMockApi()) {
    try {
      return (await mockRequest(opts.method ?? 'GET', path, opts.body, auth.getToken())) as T;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) auth.onUnauthorized();
      throw e;
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection.");
  }

  if (res.status === 401) auth.onUnauthorized();
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}
