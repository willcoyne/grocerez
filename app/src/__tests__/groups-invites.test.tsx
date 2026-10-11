import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";

import { api, ApiError } from "@/api/client";
import InviteSheet from "@/app/invite";
import { MyInvitesList } from "@/components/MyInvitesList";
import { ActiveGroupProvider, useActiveGroup, type ActiveGroupValue } from "@/state/ActiveGroupContext";
import { AuthContextForTests } from "@/state/AuthContext";
import { apiRoutes, authValue, makeTestQueryClient, renderWithProviders, testGroup } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));
const apiMock = api as jest.Mock;
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const groupB = { ...testGroup, id: "22222222-2222-4222-8222-222222222222", name: "Mom's House" };

describe("ActiveGroupContext (group switching)", () => {
  let ctx: ActiveGroupValue;
  function Probe() {
    const value = useActiveGroup();
    ctx = value;
    return <Text>{value.activeGroup?.name ?? "none"}</Text>;
  }

  async function mount() {
    await render(
      <QueryClientProvider client={makeTestQueryClient()}>
        <AuthContextForTests.Provider value={authValue()}>
          <ActiveGroupProvider>
            <Probe />
          </ActiveGroupProvider>
        </AuthContextForTests.Provider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    store.clear();
    apiMock.mockImplementation(apiRoutes({ "GET /groups": () => [testGroup, groupB] }));
  });

  it("falls back to the first group and persists a switch", async () => {
    await mount();
    await screen.findByText(testGroup.name);
    await act(async () => ctx.setActiveGroupId(groupB.id));
    expect(screen.getByText("Mom's House")).toBeTruthy();
    expect(store.get("grocerez.activeGroupId")).toBe(groupB.id);
  });

  it("ignores a saved group id I'm no longer a member of", async () => {
    store.set("grocerez.activeGroupId", "33333333-3333-4333-8333-333333333333");
    await mount();
    await screen.findByText(testGroup.name);
    expect(ctx.activeGroupId).toBe(testGroup.id);
  });
});

describe("Invites", () => {
  it("shows a friendly message for 409 ALREADY_MEMBER", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`POST /groups/${testGroup.id}/invites`]: () => {
          throw new ApiError(409, "ALREADY_MEMBER", "already");
        },
        [`GET /groups/${testGroup.id}/invites`]: () => [],
      }),
    );
    await renderWithProviders(<InviteSheet />);
    await fireEvent.changeText(screen.getByLabelText("Email address"), "Will@Example.com");
    await fireEvent.press(screen.getByText("Invite"));
    await screen.findByText("They're already in this household.");
    expect(apiMock).toHaveBeenCalledWith(`/groups/${testGroup.id}/invites`, { method: "POST", body: { email: "will@example.com" } });
  });

  it("accepting an invite makes it the active group", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        "GET /me/invites": () => [
          {
            id: "44444444-4444-4444-8444-444444444444",
            groupId: groupB.id,
            email: "carson@example.com",
            status: "pending",
            invitedBy: { id: "x", displayName: "Ian" },
            createdAt: new Date().toISOString(),
            respondedAt: null,
            group: { id: groupB.id, name: groupB.name, memberCount: 2 },
          },
        ],
        "POST /invites/44444444-4444-4444-8444-444444444444/accept": () => groupB,
        "GET /groups": () => [testGroup, groupB],
      }),
    );
    const onAccepted = jest.fn();
    const { group } = await renderWithProviders(<MyInvitesList onAccepted={onAccepted} />);
    await screen.findByText("Ian invited you");
    await fireEvent.press(screen.getByLabelText(`Accept invite to ${groupB.name}`));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(group.setActiveGroupId).toHaveBeenCalledWith(groupB.id);
  });
});
