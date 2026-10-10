import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { resetMockDb, SEED } from '@/api/mock/db';
import { mockRequest, mockTokenFor } from '@/api/mock/handler';
import { queryClient } from '@/api/queryClient';
import { storageKeys } from '@/state/storage';

/**
 * Renders the whole app (real routes, mock API) for screen and e2e tests.
 *
 * renderApp({ as?: 'ian' | 'carson' | 'will' | 'maya' | null, joined?: boolean, initialUrl?: string })
 *   as      — signed-in seed user (default 'ian'); null = signed out
 *   joined  — Ian accepts Carson's invite first, so he is in "Hack Midwest House" (default false)
 * Resets the mock DB, query cache, and stored session before rendering.
 */
export async function renderApp({
  as = 'ian',
  joined = false,
  initialUrl = '/',
}: { as?: keyof typeof SEED.users | null; joined?: boolean; initialUrl?: string } = {}) {
  resetMockDb();
  queryClient.clear();
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  store.clear();

  if (as) {
    const token = mockTokenFor(SEED.users[as]);
    store.set(storageKeys.token, token);
    if (joined && as === 'ian') await mockRequest('POST', `/invites/${SEED.inviteId}/accept`, undefined, token);
  }
  return renderRouter('./src/app', { initialUrl });
}

export { SEED };
