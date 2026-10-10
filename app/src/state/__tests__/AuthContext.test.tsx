import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";

import { api, ApiError } from "@/api/client";
import { makeTestQueryClient, testUser } from "@/test-utils";
import { AuthProvider, isNewUser, useAuth, type AuthContextValue } from "../AuthContext";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.MockedFunction<typeof api>;

let ctx: AuthContextValue;
function Probe() {
  // eslint-disable-next-line react-hooks/globals -- test probe exposes the context value
  ctx = useAuth();
  return <Text>{ctx.status}</Text>;
}

async function mount() {
  const qc = makeTestQueryClient();
  await render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe("AuthContext", () => {
  beforeEach(() => {
    store.clear();
    apiMock.mockReset();
  });

  it("stays signed in across launches: saved token → GET /me", async () => {
    store.set("grocerez.token", "saved-jwt");
    apiMock.mockResolvedValueOnce(testUser);
    await mount();
    await waitFor(() => expect(screen.getByText("signedIn")).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith("/me");
    expect(ctx.user?.email).toBe(testUser.email);
    expect(ctx.needsOnboarding).toBe(false);
  });

  it("signs out when the saved token gets a 401", async () => {
    store.set("grocerez.token", "expired");
    apiMock.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "expired"));
    await mount();
    await waitFor(() => expect(screen.getByText("signedOut")).toBeTruthy());
    expect(store.has("grocerez.token")).toBe(false);
  });

  it("keeps the cached user when the server is unreachable at launch", async () => {
    store.set("grocerez.token", "saved-jwt");
    store.set("grocerez.user", JSON.stringify(testUser));
    apiMock.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await mount();
    await waitFor(() => expect(screen.getByText("signedIn")).toBeTruthy());
  });

  it("Google sign-in posts the ID token, stores the session and flags a brand-new user for onboarding", async () => {
    apiMock.mockImplementation(async (path) => {
      if (path === "/auth/google") return { token: "app-jwt", user: { ...testUser, createdAt: new Date().toISOString() } };
      throw new Error(`unexpected ${path}`);
    });
    await mount();
    await waitFor(() => expect(screen.getByText("signedOut")).toBeTruthy());
    const prevId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    // config is read at import time; patch the module value instead.
    const { config } = jest.requireActual("@/config") as typeof import("@/config");
    config.googleWebClientId = "web-client-id";
    await act(async () => {
      await ctx.signInWithGoogle();
    });
    config.googleWebClientId = prevId ?? "";
    expect(apiMock).toHaveBeenCalledWith("/auth/google", { method: "POST", body: { idToken: "google-id-token" } });
    expect(store.get("grocerez.token")).toBe("app-jwt");
    expect(ctx.status).toBe("signedIn");
    expect(ctx.needsOnboarding).toBe(true);
  });

  it("returning users skip onboarding; sign out clears storage and Google", async () => {
    apiMock.mockResolvedValueOnce({ token: "demo-jwt", user: testUser });
    await mount();
    await waitFor(() => expect(screen.getByText("signedOut")).toBeTruthy());
    await act(async () => {
      await ctx.signInAsDemo(testUser.id);
    });
    expect(apiMock).toHaveBeenCalledWith(`/dev/login-as/${testUser.id}`, expect.objectContaining({ method: "POST" }));
    expect(ctx.needsOnboarding).toBe(false);
    await act(async () => {
      await ctx.signOut();
    });
    expect(GoogleSignin.signOut).toHaveBeenCalled();
    expect(ctx.status).toBe("signedOut");
    expect(store.has("grocerez.token")).toBe(false);
  });

  it("isNewUser: created within the last minute", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(isNewUser({ ...testUser, createdAt: "2026-10-10T11:59:30Z" }, now)).toBe(true);
    expect(isNewUser({ ...testUser, createdAt: "2026-10-10T11:58:00Z" }, now)).toBe(false);
  });
});
