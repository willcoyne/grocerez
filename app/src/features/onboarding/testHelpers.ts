import { act } from 'expo-router/testing-library';

import * as client from '@/api/client';
import { ApiError } from '@/api/client';

// Shared helpers for the onboarding tests in ./__tests__ (kept outside __tests__ so Jest doesn't run it as a suite).
// Note: with @testing-library/react-native 14, fireEvent is async — always `await` it, or act() scopes overlap
// and later tests in the same file render nothing.

const realApi = client.api;

/** Makes GET {path} fail with a non-retryable error. Returns restore(). */
export function failGet(path: string): () => void {
  const spy = jest.spyOn(client, 'api').mockImplementation(((p: string, opts?: { method?: string }) =>
    p === path && (!opts?.method || opts.method === 'GET')
      ? Promise.reject(new ApiError(400, 'TEST', 'test failure'))
      : realApi(p, opts as never)) as typeof client.api);
  return () => spy.mockRestore();
}

/** Flushes pending state updates (fake timers are on under renderRouter). */
export async function flush(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}
