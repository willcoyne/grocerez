import type { User } from "@contracts/auth";
import type { Group } from "@contracts/groups";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { ToastProvider } from "@/components/Toast";
import { ActiveGroupContextForTests, type ActiveGroupValue } from "@/state/ActiveGroupContext";
import { AuthContextForTests, type AuthContextValue } from "@/state/AuthContext";

export const testUser: User = {
  id: "00000000-0000-4000-8000-000000000101",
  email: "carson@example.com",
  displayName: "Carson",
  avatarUrl: null,
  zipCode: "64105",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const testGroup: Group = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Hack Midwest House",
  role: "owner",
  memberCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function authValue(over: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "signedIn",
    token: "jwt",
    user: testUser,
    needsOnboarding: false,
    signInWithGoogle: jest.fn(async () => true),
    signInAsDemo: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    setUser: jest.fn(),
    finishOnboarding: jest.fn(),
    ...over,
  };
}

export function groupValue(over: Partial<ActiveGroupValue> = {}): ActiveGroupValue {
  return {
    activeGroupId: testGroup.id,
    activeGroup: testGroup,
    groups: [testGroup],
    groupsLoading: false,
    groupsError: null,
    refetchGroups: jest.fn(),
    setActiveGroupId: jest.fn(),
    ...over,
  };
}

/** Renders inside QueryClient + fixed Auth/ActiveGroup contexts + Toasts. The API module is mocked per test. */
export async function renderWithProviders(
  ui: ReactElement,
  opts: { auth?: Partial<AuthContextValue>; group?: Partial<ActiveGroupValue>; queryClient?: QueryClient } = {},
) {
  const queryClient = opts.queryClient ?? makeTestQueryClient();
  const auth = authValue(opts.auth);
  const group = groupValue(opts.group);
  const result = await render(
    <QueryClientProvider client={queryClient}>
      <AuthContextForTests.Provider value={auth}>
        <ActiveGroupContextForTests.Provider value={group}>
          <ToastProvider>{ui}</ToastProvider>
        </ActiveGroupContextForTests.Provider>
      </AuthContextForTests.Provider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, auth, group };
}

/** Route `api()` calls by "METHOD /path" to handlers. Unknown routes reject with a 404 ApiError. */
export function apiRoutes(routes: Record<string, (body: unknown, query?: unknown) => unknown>) {
  const { ApiError } = jest.requireActual("@/api/client") as typeof import("@/api/client");
  return jest.fn(async (path: string, opts: { method?: string; body?: unknown; query?: unknown } = {}) => {
    const key = `${opts.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (!handler) throw new ApiError(404, "NOT_FOUND", `No mock for ${key}`);
    return handler(opts.body, opts.query);
  });
}
