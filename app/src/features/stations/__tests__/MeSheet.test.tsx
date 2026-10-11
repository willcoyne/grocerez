import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

import { MeSheet } from "../MeSheet";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock("@/api/hooks/uploads", () => ({ pickAndUploadImage: jest.fn(async () => "avatars/new.jpg") }));
// The catalog picker has its own tests.
jest.mock("@/components/ItemPicker", () => ({ ItemPicker: () => null }));

const apiMock = api as jest.Mock;
const g = testGroup.id;

const pref = {
  id: "55555555-5555-4555-8555-555555555555",
  groupId: g,
  userId: testUser.id,
  itemId: "66666666-6666-4666-8666-666666666666",
  item: { id: "66666666-6666-4666-8666-666666666666", name: "Oat milk", category: "dairy" },
  user: { id: testUser.id, displayName: testUser.displayName },
  quantityText: null,
  recurrence: "staple",
  note: null,
  createdAt: "",
  updatedAt: "",
};

function routes(over: Record<string, (body: unknown, query?: unknown) => unknown> = {}) {
  return apiRoutes({
    [`GET /groups/${g}/preferences`]: () => [pref],
    [`GET /groups/${g}/cabinet`]: () => [],
    [`GET /groups/${g}/shopping-list`]: () => [],
    "GET /me/dietary": () => ({ diets: [], allergens: ["peanuts"] }),
    "PUT /me/dietary": (body) => body,
    "PATCH /me": (body) => ({ ...testUser, ...(body as object) }),
    ...over,
  });
}

describe("MeSheet", () => {
  it("shows me in the header and every section with data", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<MeSheet visible onClose={jest.fn()} />);
    expect(screen.getByText(testUser.displayName)).toBeTruthy();
    expect(screen.getByText(testUser.email)).toBeTruthy();
    expect(screen.getByText("What I want from the store")).toBeTruthy();
    expect(await screen.findByText("Oat milk")).toBeTruthy();
    expect(screen.getByText("Diet & allergies")).toBeTruthy();
    expect(await screen.findByTestId("allergen-peanuts")).toBeTruthy();
    expect(screen.getByTestId("allergen-peanuts").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByTestId("appearance-picker")).toBeTruthy();
    expect(screen.getByTestId("me-sign-out")).toBeTruthy();
  });

  it("toggling an allergy saves it", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<MeSheet visible onClose={jest.fn()} />);
    await fireEvent.press(await screen.findByTestId("allergen-milk"));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/me/dietary", { method: "PUT", body: { diets: [], allergens: ["peanuts", "milk"] } }),
    );
  });

  it("shows an error with retry when diet & allergies fail to load", async () => {
    let fail = true;
    apiMock.mockImplementation(
      routes({
        "GET /me/dietary": () => {
          if (fail) throw new ApiError(500, "INTERNAL", "Server sad");
          return { diets: [], allergens: [] };
        },
      }),
    );
    await renderWithProviders(<MeSheet visible onClose={jest.fn()} />);
    expect(await screen.findByTestId("me-dietary-error")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByTestId("me-dietary-error-retry"));
    expect(await screen.findByTestId("allergen-milk")).toBeTruthy();
  });

  it("saves a new ZIP and uploads a photo", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<MeSheet visible onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId("me-zip"), "10001");
    await fireEvent.press(screen.getByTestId("me-zip-save"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/me", { method: "PATCH", body: { zipCode: "10001" } }));
    await fireEvent.press(screen.getByTestId("me-change-photo"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/me", { method: "PATCH", body: { avatarKey: "avatars/new.jpg" } }));
  });

  it("asks to join a household when there is no active group", async () => {
    apiMock.mockImplementation(routes());
    await renderWithProviders(<MeSheet visible onClose={jest.fn()} />, {
      group: { activeGroupId: null, activeGroup: null, groups: [] },
    });
    expect(screen.getByText(/Join or create a household/)).toBeTruthy();
  });

  it("sign out closes the sheet and signs out", async () => {
    apiMock.mockImplementation(routes());
    const onClose = jest.fn();
    const { auth } = await renderWithProviders(<MeSheet visible onClose={onClose} />);
    await fireEvent.press(screen.getByTestId("me-sign-out"));
    expect(onClose).toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });
});
