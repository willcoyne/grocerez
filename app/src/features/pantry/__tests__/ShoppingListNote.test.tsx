import type { ShoppingListItem } from "@contracts/shoppingList";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { keys } from "@/api/keys";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

import { noteSections, ShoppingListNote } from "../overlay/ShoppingListNote";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));
// The catalog picker has its own tests; here it is a button that picks "Bread".
jest.mock("@/components/ItemPicker", () => {
  const { createElement: h } = jest.requireActual("react");
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    ItemPicker: (p: { visible: boolean; onPick: (i: unknown) => void }) =>
      p.visible
        ? h(
            Pressable,
            { accessibilityLabel: "Pick Bread", onPress: () => p.onPick({ id: "item-bread", name: "Bread" }) },
            h(Text, null, "pick"),
          )
        : null,
  };
});

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
  } as ShoppingListItem;
}

const milk = row({
  id: "r1",
  name: "Milk",
  category: "dairy",
  quantityText: "2 gal",
  wantedBy: [
    { userId: testUser.id, displayName: "Carson" },
    { userId: "u3", displayName: "Will" },
  ],
  allergenFlags: [
    { userId: "u3", displayName: "Will", allergen: "milk" },
    { userId: testUser.id, displayName: "Carson", allergen: "milk" },
  ],
});
const apples = row({ id: "r2", name: "Apples", category: "produce" });
const towels = row({ id: "r3", name: "Paper towels", category: "household", reason: "manual", wantedBy: [] });
const eggs = row({ id: "r4", name: "Eggs", category: "dairy", checked: true });

function renderNote(props: Partial<React.ComponentProps<typeof ShoppingListNote>> = {}) {
  const onClose = jest.fn();
  const onStartShopping = jest.fn();
  const r = renderWithProviders(
    <ShoppingListNote visible groupId={g} onClose={onClose} onStartShopping={onStartShopping} {...props} />,
  );
  return { r, onClose, onStartShopping };
}

describe("noteSections", () => {
  it("groups unchecked rows by category in server order and keeps checked rows apart", () => {
    const s = noteSections([milk, apples, eggs, towels]);
    expect(s.toBuy.map((x) => x.title)).toEqual(["Dairy", "Produce", "Household"]);
    expect(s.toBuy[0].rows.map((r) => r.item.name)).toEqual(["Milk"]);
    expect(s.checked.map((r) => r.item.name)).toEqual(["Eggs"]);
  });
});

describe("ShoppingListNote", () => {
  it("renders nothing when not visible", async () => {
    apiMock.mockImplementation(apiRoutes({}));
    await renderWithProviders(<ShoppingListNote visible={false} groupId={g} onClose={jest.fn()} onStartShopping={jest.fn()} />);
    expect(screen.queryByTestId("list-note")).toBeNull();
  });

  it("shows a loading state, then the friendly empty state", async () => {
    let resolve: (v: unknown) => void = () => {};
    apiMock.mockImplementation(
      apiRoutes({ [`GET /groups/${g}/shopping-list`]: () => new Promise((r) => (resolve = r)) }),
    );
    await renderNote().r;
    expect(screen.getByTestId("list-note-loading")).toBeTruthy();
    await act(async () => resolve([]));
    expect(await screen.findByText("Nothing to buy — your pantry is stocked!")).toBeTruthy();
    expect(screen.queryByLabelText("Start shopping")).toBeNull();
  });

  it("shows an error with retry", async () => {
    let fail = true;
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => {
          if (fail) throw new ApiError(500, "INTERNAL", "Server sad");
          return [apples];
        },
      }),
    );
    await renderNote().r;
    expect(await screen.findByTestId("list-note-error")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByText(/try again|retry/i));
    expect(await screen.findByText("Apples")).toBeTruthy();
  });

  it("lists rows by aisle with quantity, who wants it and named allergen badges (mine first)", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/shopping-list`]: () => [milk, apples, eggs, towels] }));
    await renderNote().r;
    expect(await screen.findByText("Milk")).toBeTruthy();
    expect(screen.getByText("3 to buy · 1 in the cart")).toBeTruthy();
    expect(screen.getByText("2 gal · For you, Will")).toBeTruthy();
    expect(screen.getByText("Added by hand")).toBeTruthy();
    // Badges carry text + an icon (not colour alone); the signed-in user's is labelled "you".
    expect(screen.getByText("Milk · you")).toBeTruthy();
    expect(screen.getByText("Milk · Will")).toBeTruthy();
    expect(screen.getByLabelText("Allergen warning: contains milk, you are allergic")).toBeTruthy();
    expect(screen.getByLabelText("Allergen warning: contains milk, Will is allergic")).toBeTruthy();
    // Checked rows sit in "In the cart" at the bottom, struck through.
    expect(screen.getByText("In the cart")).toBeTruthy();
    expect(screen.getByLabelText("Uncheck Eggs")).toBeTruthy();
    // Only manual rows get the small delete button.
    expect(screen.getByLabelText("Remove Paper towels from the list")).toBeTruthy();
    expect(screen.queryByLabelText("Remove Milk from the list")).toBeNull();
  });

  it("check-off is optimistic and rolls back when the request fails", async () => {
    let rejectPatch: (e: unknown) => void = () => {};
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => [apples],
        [`PATCH /groups/${g}/shopping-list/r2`]: () => new Promise((_, rej) => (rejectPatch = rej)),
      }),
    );
    const { r } = renderNote();
    const { queryClient } = await r;
    await fireEvent.press(await screen.findByLabelText("Check off Apples"));
    expect(screen.getByLabelText("Uncheck Apples")).toBeTruthy();
    expect(queryClient.getQueryData<ShoppingListItem[]>(keys.shoppingList(g))?.[0].checked).toBe(true);
    await act(async () => rejectPatch(new ApiError(503, "UNAVAILABLE", "No signal")));
    expect(await screen.findByLabelText("Check off Apples")).toBeTruthy();
  });

  it("deletes a manual row with the small ×", async () => {
    const del = jest.fn(() => undefined);
    apiMock.mockImplementation(
      apiRoutes({ [`GET /groups/${g}/shopping-list`]: () => [towels], [`DELETE /groups/${g}/shopping-list/r3`]: del }),
    );
    await renderNote().r;
    await fireEvent.press(await screen.findByLabelText("Remove Paper towels from the list"));
    expect(del).toHaveBeenCalled();
    expect(await screen.findByText("Removed Paper towels from the list")).toBeTruthy();
  });

  it("long-pressing a wanted row explains the 409 kindly and keeps the row", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/shopping-list`]: () => [apples],
        [`DELETE /groups/${g}/shopping-list/r2`]: () => {
          throw new ApiError(409, "PREFERENCE_ROW", "This item is on the list because of a preference");
        },
      }),
    );
    await renderNote().r;
    await fireEvent(await screen.findByLabelText("Check off Apples"), "longPress");
    expect(
      await screen.findByText("Apples is on the list because someone wants it. Remove it from their preferences instead."),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Apples")).toBeTruthy());
  });

  it("adds an item through the catalog picker", async () => {
    const post = jest.fn(() => row({ id: "r9", name: "Bread", reason: "manual" }));
    apiMock.mockImplementation(
      apiRoutes({ [`GET /groups/${g}/shopping-list`]: () => [apples], [`POST /groups/${g}/shopping-list`]: post }),
    );
    await renderNote().r;
    await fireEvent.press(await screen.findByLabelText("Add an item to the shopping list"));
    // The real picker is a <Modal>; the stub renders as a sibling of the (accessibility-modal) sheet.
    await fireEvent.press(screen.getByLabelText("Pick Bread", { includeHiddenElements: true }));
    expect(post).toHaveBeenCalledWith({ itemId: "item-bread" }, undefined);
    expect(await screen.findByText("Added Bread to the list")).toBeTruthy();
  });

  it("Start shopping and close call back to the screen", async () => {
    apiMock.mockImplementation(apiRoutes({ [`GET /groups/${g}/shopping-list`]: () => [apples] }));
    const { r, onClose, onStartShopping } = renderNote();
    await r;
    await fireEvent.press(await screen.findByLabelText("Start shopping"));
    expect(onStartShopping).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("list-note-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
