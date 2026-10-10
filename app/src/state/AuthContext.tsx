import type { AuthResponse, User } from "@contracts/auth";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { googleIdToken, googleSignOut } from "@/auth/google";
import { api, ApiError, configureApiSession } from "@/api/client";
import { keys } from "@/api/keys";
import { config } from "@/config";
import { storage, storageKeys } from "./storage";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  token: string | null;
  user: User | null;
  /** True right after a brand-new account signs in, until onboarding finishes or is skipped. */
  needsOnboarding: boolean;
  signInWithGoogle: () => Promise<boolean>;
  signInAsDemo: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  finishOnboarding: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** A user created within the last minute counts as new (plan 02 step 2). */
export function isNewUser(user: User, now = Date.now()) {
  const created = Date.parse(user.createdAt);
  return Number.isFinite(created) && now - created < 60_000;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<User | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const clearSession = useCallback(async () => {
    tokenRef.current = null;
    setToken(null);
    setUserState(null);
    setNeedsOnboarding(false);
    setStatus("signedOut");
    queryClient.clear();
    await Promise.all([
      storage.remove(storageKeys.token),
      storage.remove(storageKeys.user),
      storage.remove(storageKeys.activeGroupId),
    ]);
  }, [queryClient]);

  // Bridge to the API client: current token + "401 clears the session".
  useEffect(() => {
    configureApiSession({
      getToken: () => tokenRef.current,
      onUnauthorized: () => {
        void clearSession();
      },
    });
  }, [clearSession]);

  const setUser = useCallback((u: User) => {
    setUserState(u);
    queryClient.setQueryData(keys.me, u);
    void storage.set(storageKeys.user, JSON.stringify(u));
  }, [queryClient]);

  const startSession = useCallback(
    async (res: AuthResponse) => {
      tokenRef.current = res.token;
      await storage.set(storageKeys.token, res.token);
      await storage.set(storageKeys.user, JSON.stringify(res.user));
      queryClient.clear();
      queryClient.setQueryData(keys.me, res.user);
      setToken(res.token);
      setUserState(res.user);
      setNeedsOnboarding(isNewUser(res.user));
      setStatus("signedIn");
    },
    [queryClient],
  );

  // On launch: token from secure storage → GET /me (sign out on 401; keep the cached user when offline).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await storage.get(storageKeys.token);
      if (!saved) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      tokenRef.current = saved;
      try {
        const me = await api<User>("/me");
        if (cancelled) return;
        await storage.set(storageKeys.user, JSON.stringify(me));
        queryClient.setQueryData(keys.me, me);
        setToken(saved);
        setUserState(me);
        setStatus("signedIn");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          await clearSession();
          return;
        }
        const cached = await storage.get(storageKeys.user);
        if (cached) {
          setToken(saved);
          setUserState(JSON.parse(cached) as User);
          setStatus("signedIn");
        } else {
          await clearSession();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession, queryClient]);

  const signInWithGoogle = useCallback(async () => {
    const idToken = await googleIdToken();
    if (!idToken) return false;
    const res = await api<AuthResponse>("/auth/google", { method: "POST", body: { idToken } });
    await startSession(res);
    return true;
  }, [startSession]);

  const signInAsDemo = useCallback(
    async (userId: string) => {
      const res = await api<AuthResponse>(`/dev/login-as/${userId}`, {
        method: "POST",
        headers: config.demoKey ? { "x-demo-key": config.demoKey } : undefined,
      });
      await startSession(res);
    },
    [startSession],
  );

  const signOut = useCallback(async () => {
    await googleSignOut();
    await clearSession();
  }, [clearSession]);

  const finishOnboarding = useCallback(() => setNeedsOnboarding(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, token, user, needsOnboarding, signInWithGoogle, signInAsDemo, signOut, setUser, finishOnboarding }),
    [status, token, user, needsOnboarding, signInWithGoogle, signInAsDemo, signOut, setUser, finishOnboarding],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** For tests and stories: provide a fixed auth value. */
export const AuthContextForTests = AuthContext;
