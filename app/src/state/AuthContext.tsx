import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { setAuthHandlers } from '@/api/client';
import { queryClient } from '@/api/queryClient';

const TOKEN_KEY = 'grocerez.session.token';

type AuthState = {
  /** True until the stored token has been read on launch. */
  loading: boolean;
  token: string | null;
  setToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Session storage only. Google sign-in, the user object, and GET /me on launch are added in 02-auth-onboarding.
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
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const setToken = useCallback(async (next: string) => {
    apply(next);
    await SecureStore.setItemAsync(TOKEN_KEY, next);
  }, []);

  useEffect(() => {
    setAuthHandlers({ getToken: () => tokenRef.current, onUnauthorized: () => void signOut() });
    SecureStore.getItemAsync(TOKEN_KEY)
      .then(apply)
      .catch(() => apply(null))
      .finally(() => setLoading(false));
  }, [signOut]);

  const value = useMemo(() => ({ loading, token, setToken, signOut }), [loading, token, setToken, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
