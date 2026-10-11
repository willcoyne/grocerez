import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

import { HouseholdSheet } from "../HouseholdSheet";

const mockPush = jest.fn();
jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: mockPush }), useFocusEffect: jest.fn() }));
jest.mock("expo-notifications", () => ({}));
const mockRequestStation = jest.fn();
jest.mock("@/features/pantry/roomNav", () => ({ requestStation: (id: string) => mockRequestStation(id) }));
jest.mock("@/lib/confirm", () => ({ confirm: jest.fn(async () => true) }));

const apiMock = api as jest.Mock;
const g = testGroup.id;
const groupB = { ...testGroup, id: "22222222-2222-4222-8222-222222222222", name: "Mom's House", role: "member" as const };
const will = {
  id: "00000000-0000-4000-8000-000000000103",
  displayName: "Will",
  email: "will@example.com",
  avatarUrl: null,
  role: "member" as const,
  joinedAt: "",
};

function routes(over: Record<string, (body: unknown, query?: unknown) => unknown> = {}) {
  return apiRoutes({
    [`GET /groups/${g}`]: () => ({
      ...testGroup,
      members: [{ id: testUser.id, displayName: testUser.displayName, email: testUser.email, avatarUrl: null, role: "owner", joinedAt: "" }, will],
    }),
    [`GET /groups/${g}/invites`]: () => [
      {
        id: "77777777-7777-4777-8777-777777777777",
        groupId: g,
        email: "ian@example.com",
        status: "pending",
        invitedBy: { id: testUser.id, displayName: testUser.displayName },
        createdAt: new Date().toISOString(),
        respondedAt: null,
      },
    ],
    [`GET /groups/${g}/alerts`]: () => ({ expiring: [], recalls: [] }),
    [`GET /groups/${g}/preferences`]: () => [],
    [`GET /groups/${g}/cabinet`]: () => [],
    "GET /me/invites": () => [],
    [`POST /groups/${g}/invites`]: (body) => ({
      id: "88888888-8888-4888-8888-888888888888",
      groupId: g,
      email: (body as { email: string }).email,
      status: "pending",
      invitedBy: null,
      createdAt: new Date().toISOString(),
      respondedAt: null,
    }),
    ...over,
  });
}

describe("HouseholdSheet", () => {
  it("shows members, pending invites, alerts and my email while I wait for invites", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />);
    expect(screen.getAllByText(testGroup.name).length).toBeGreaterThan(0);
    expect(await screen.findByText("Will")).toBeTruthy();
    expect(screen.getByText(`${testUser.displayName} (you)`)).toBeTruthy();
    expect(await screen.findByText("ian@example.com")).toBeTruthy();
    expect(await screen.findByText("Nothing expiring and no recalls.")).toBeTruthy();
    expect(await screen.findByText(`No invites yet. Ask someone in your household to invite ${testUser.email}.`)).toBeTruthy();
  });

  it("shows a members error with retry", async () => {
    let fail = true;
    apiMock.mockImplementation(
      routes({
        [`GET /groups/${g}`]: () => {
          if (fail) throw new ApiError(500, "INTERNAL", "Server sad");
          return { ...testGroup, members: [will] };
        },
      }),
    );
    await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />);
    expect(await screen.findByTestId("household-members-error")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByTestId("household-members-error-retry"));
    expect(await screen.findByText("Will")).toBeTruthy();
  });

  it("opens this week's dinners (the Week paper), prices and create household", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId("household-recipes"));
    expect(mockRequestStation).toHaveBeenCalledWith("week");
    await fireEvent.press(screen.getByTestId("household-prices"));
    await fireEvent.press(screen.getByTestId("household-create"));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual(["/prices", "/create-group"]);
  });

  it("invites by email (lower-cased) and rejects a bad address", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />);
    await screen.findByText("ian@example.com");
    await fireEvent.changeText(screen.getByTestId("household-invite-input"), "nope");
    await fireEvent.press(screen.getByTestId("household-invite-button"));
    expect(screen.getByText("Enter a full email address, like name@example.com")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("household-invite-input"), "Sam@Example.com ");
    await fireEvent.press(screen.getByTestId("household-invite-button"));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/invites`, { method: "POST", body: { email: "sam@example.com" } }),
    );
  });

  it("switches household from the radio list", async () => {
    apiMock.mockImplementation(routes());
    const { group } = await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />, {
      group: { groups: [testGroup, groupB] },
    });
    expect(screen.getByTestId(`household-option-${g}`).props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByTestId(`household-option-${groupB.id}`));
    expect(group.setActiveGroupId).toHaveBeenCalledWith(groupB.id);
  });

  it("without a household offers create and my invites", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />, {
      group: { activeGroupId: null, activeGroup: null, groups: [] },
    });
    expect(screen.getByText("You're not in a household yet")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("household-create"));
    expect(mockPush).toHaveBeenCalledWith("/create-group");
    expect(await screen.findByText(/No invites yet/)).toBeTruthy();
  });

  it("owner can leave after confirming", async () => {
    apiMock.mockImplementation(routes({ [`POST /groups/${g}/leave`]: () => undefined }));
    await renderWithProviders(<HouseholdSheet visible onClose={jest.fn()} />);
    await fireEvent.press(await screen.findByText("Leave household"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/leave`, { method: "POST" }));
  });
});
