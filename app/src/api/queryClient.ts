import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";

import { ApiError, isRetryable } from "./client";

/**
 * Server-state cache. staleTime 30s, queries retry twice, mutations retry 3 times so check-offs
 * survive bad store signal (mutations pause while offline and resume when the phone is back online).
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => count < 2 && isRetryable(error),
      },
      mutations: {
        retry: (count, error) => count < 3 && isRetryable(error),
      },
    },
  });
}

/** Wire TanStack's online/focus managers to React Native (NetInfo + AppState). Call once at startup. */
export function setupReactQueryNative() {
  if (Platform.OS === "web") return () => {};
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
  const sub = AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });
  return () => sub.remove();
}

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
