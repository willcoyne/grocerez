import type { AuthResponse } from '@contracts/models';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api, setAuthHandlers } from '@/api/client';
import { qk } from '@/api/keys';
import { queryClient } from '@/api/queryClient';

import { getGoogleIdToken, googleSignOut } from './googleAuth';
import { deleteItem, getItem, setItem, storageKeys } from './storage';

/**
 * useAuth(): {
 *   loading: boolean                       // true until the stored session has been read on launch
 *   token: string | null
 *   signInWithGoogle(): Promise<void>      // Google → POST /auth/google → store token (mock: signs in as Ian)
 *   signInAs(userId: string): Promise<void> // __DEV__ demo users → POST /dev/login-as/:id
 *   signOut(): Promise<void>               // clears token, active group, and the query cache
 * }
 * The signed-in user comes from useMe() (src/api/hooks/useMe.ts).
 */
type AuthState = {
  loading: boolean;
  token: string | null;
  signInWithGoogle: () => Promise<void>;
  signInAs: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const apply = (next: string | null) => {
    tokenRef.current = next;
    setTokenState(next);
  };

  const signOut = useCallback(async () => {
    apply(null);
    queryClient.clear();
    await Promise.all([deleteItem(storageKeys.token), deleteItem(storageKeys.activeGroupId), googleSignOut()]);
  }, []);

  const startSession = useCallback(async (res: AuthResponse) => {
    queryClient.clear();
    queryClient.setQueryData(qk.me(), res.user);
    apply(res.token);
    await setItem(storageKeys.token, res.token);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const idToken = await getGoogleIdToken();
    await startSession(await api<AuthResponse>('/auth/google', { method: 'POST', body: { idToken } }));
  }, [startSession]);

  const signInAs = useCallback(
    async (userId: string) => {
      await startSession(await api<AuthResponse>(`/dev/login-as/${encodeURIComponent(userId)}`, { method: 'POST' }));
    },
    [startSession],
  );

  useEffect(() => {
    setAuthHandlers({ getToken: () => tokenRef.current, onUnauthorized: () => void signOut() });
    getItem(storageKeys.token)
      .then(apply)
      .finally(() => setLoading(false));
  }, [signOut]);

  const value = useMemo(
    () => ({ loading, token, signInWithGoogle, signInAs, signOut }),
    [loading, token, signInWithGoogle, signInAs, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
