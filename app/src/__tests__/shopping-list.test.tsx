import type { ShoppingListItem } from "@contracts/shoppingList";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { keys } from "@/api/keys";
import ListScreen from "@/app/(tabs)/list";
import { toSections } from "@/lib/listSections";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("@/lib/confirm", () => ({ confirm: jest.fn(async () => true) }));
jest.mock("@/notifications/expirations", () => ({ maybeAskNotificationPermission: jest.fn() }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual<typeof import("react")>("react").useEffect(cb, [cb]),
}));
const apiMock = api as jest.Mock;
const g = testGroup.id;

function row(over: Partial<ShoppingListItem> & { id: string; name: string; category?: string }): ShoppingListItem {
  const { name, category = "pantry", ...rest } = over;
  return {
    groupId: g,
    itemId: `item-${over.id}`,
    item: { id: `item-${over.id}`, name, category },
    reason: "preference",
    wantedBy: [{ userId: "u3", displayName: "Will" }],
    quantityText: null,
    allergenFlags: [],
    checked: false,
    checkedBy: null,
    checkedAt: null,
    scannedProductId: null,
    addedBy: null,
    createdAt: "",
    updatedAt: "",
    ...rest,
  };
}

const milk = row({
  id: "a1",
  name: "Milk",
  category: "dairy",
  allergenFlags: [{ userId: "u3", displayName: "User 3", allergen: "milk" }],
});
const oreos = row({ id: "a2", name: "Oreos", category: "snacks" });

describe("toSections", () => {
  it("keeps the server's aisle order and moves checked rows to the bottom", () => {
    const a = row({ id: "1", name: "A" });
    const b = row({ id: "2", name: "B", checked: true });
    const c = row({ id: "3", name: "C" });
    const s = toSections([row({ id: "0", name: "Bananas", category: "produce" }), b, a, c]);
    expect(s.map((x) => x.title)).toEqual(["Produce", "Pantry"]);
    expect(s[1].data.map((r) => r.item.name)).toEqual(["A", "C", "B"]);
  });
});

describe("Shopping list", () => {
  beforeEach(() => mockPush.mockReset());

  it("shows allergen chips with member and allergen, and the running-low chip", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => [milk, oreos],
        [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
        [`GET /groups/${g}/cabinet`]: () => [{ id: "c1", itemId: oreos.itemId, status: "running_low" }],
      }),
    );
    await renderWithProviders(<ListScreen />);
    expect(await screen.findByText("Contains milk · User 3")).toBeTruthy();
    expect(screen.getByText("2 to buy · 0 in the cart")).toBeTruthy();
    expect(await screen.findByText("Running low at home")).toBeTruthy();
    expect(screen.getByText("Check items off as you shop")).toBeTruthy();
  });

  it("check-off is optimistic and rolls back when the request finally fails", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    let rejectPatch: (e: unknown) => void = () => {};
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => [milk, oreos],
        [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
        [`PATCH /groups/${g}/shopping-list/${oreos.id}`]: () =>
          new Promise((res, rej) => {
            resolvePatch = res;
            rejectPatch = rej;
          }),
      }),
    );
    const { queryClient } = await renderWithProviders(<ListScreen />);
    await fireEvent.press(await screen.findByLabelText("Check off Oreos"));
    // Optimistic: checked immediately, with a syncing dot and "checked by you".
    await screen.findByText("1 to buy · 1 in the cart");
    expect(screen.getByLabelText("Syncing")).toBeTruthy();
    expect(screen.getByText("In the cart · checked by you")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list/${oreos.id}`, { method: "PATCH", body: { checked: true } });

    rejectPatch(new ApiError(500, "INTERNAL", "Server hiccup"));
    await screen.findByText("2 to buy · 0 in the cart");
    expect(queryClient.getQueryData<ShoppingListItem[]>(keys.shoppingList(g))?.find((r) => r.id === oreos.id)?.checked).toBe(false);
    void resolvePatch;
  });

  it("Finish trip is disabled while the request is in flight, then opens the expiration check", async () => {
    let finish: (v: unknown) => void = () => {};
    const checked = { ...oreos, checked: true, checkedBy: testUser.id };
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => [milk, checked],
        [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
        [`POST /groups/${g}/shopping-list/complete`]: () => new Promise((res) => (finish = res)),
      }),
    );
    await renderWithProviders(<ListScreen />);
    await fireEvent.press(await screen.findByText("Finish trip · move 1 to the cabinet"));
    await waitFor(() => expect(screen.getByLabelText("Finishing…")).toBeDisabled());
    finish({ movedToCabinet: 1 });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/expiration-check?itemIds=${checked.itemId}`));
    await screen.findByText("1 item moved to the cabinet");
  });
});
