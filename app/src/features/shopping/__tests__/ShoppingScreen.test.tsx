import type { ShoppingListItem } from "@contracts/shoppingList";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

import { api } from "@/api/client";
import { apiRoutes, renderWithProviders, testGroup, testUser } from "@/test-utils";

import { ShoppingScreen } from "../ShoppingScreen";

// The 3D scene can't run under Jest (no WebGL; three.js is ESM). The HUD, checklist and trip logic can.
jest.mock("../scene/StoreCanvas", () => ({ StoreCanvas: () => null }));
jest.mock("../scene/StoreScene", () => ({ StoreScene: () => null }));
jest.mock("../../pantry/data", () => ({ groupFor: () => "ingredients" }));
jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = new Proxy({}, { get: () => () => chain });
  return { GestureDetector: ({ children }: { children: React.ReactNode }) => children, Gesture: { Pan: () => chain } };
});
const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, useFocusEffect: jest.fn() }));
// The camera ScanSheet is its own feature (features/scan, tested there): a stand-in that shows what it was given and
// can report a scanned row as added to the cart, like the real sheet does after saving the check.
jest.mock("@/features/scan", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    ScanSheet: ({ visible, onClose, context, onAddedToCart }: MockScanProps) =>
      visible ? (
        <View testID="scan-sheet">
          <Text>{`scan ${context.kind} · ${context.list.length} rows`}</Text>
          <Pressable accessibilityRole="button" onPress={() => onAddedToCart?.(context.list[0].id, {})}>
            <Text>fake scan first row</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose}>
            <Text>close scan</Text>
          </Pressable>
        </View>
      ) : null,
  };
});
type MockScanProps = {
  visible: boolean;
  onClose: () => void;
  context: { kind: string; list: { id: string }[] };
  onAddedToCart?: (id: string, product: unknown) => void;
};
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: jest.fn(),
}));

const G = testGroup.id;
const ANN = "00000000-0000-4000-8000-000000000202";
let n = 0;
function row(name: string, category: string, over: Partial<ShoppingListItem> = {}): ShoppingListItem {
  n += 1;
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  return {
    id,
    groupId: G,
    itemId: id.replace(/^a+/, "bbbbbbbb"),
    item: { id: id.replace(/^a+/, "bbbbbbbb"), name, category },
    reason: "preference",
    wantedBy: [],
    quantityText: null,
    allergenFlags: [],
    checked: false,
    checkedBy: null,
    checkedAt: null,
    scannedProductId: null,
    addedBy: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

let list: ShoppingListItem[];
let completes: number;
let patches: { id: string; checked: boolean }[];

function mockServer() {
  (api as jest.Mock).mockImplementation(
    apiRoutes({
      [`GET /groups/${G}/shopping-list`]: () => list.map((r) => ({ ...r })),
      [`POST /groups/${G}/shopping-list/complete`]: () => {
        completes += 1;
        const moved = list.filter((r) => r.checked).length;
        list = list.filter((r) => !r.checked);
        return { movedToCabinet: moved };
      },
      ...Object.fromEntries(
        list.map((r) => [
          `PATCH /groups/${G}/shopping-list/${r.id}`,
          (body: unknown) => {
            const { checked } = body as { checked: boolean };
            patches.push({ id: r.id, checked });
            const cur = list.find((x) => x.id === r.id);
            if (cur) cur.checked = checked;
            return { ...(cur ?? r), checked };
          },
        ]),
      ),
    }),
  );
}

beforeEach(() => {
  n = 0;
  completes = 0;
  patches = [];
  list = [
    row("Bananas", "produce", { quantityText: "1 bunch" }),
    row("Milk", "dairy", { allergenFlags: [{ userId: testUser.id, displayName: "Carson", allergen: "milk" }] }),
    row("Bagels", "bakery", { allergenFlags: [{ userId: ANN, displayName: "Ann", allergen: "sesame" }] }),
  ];
  mockServer();
});

// The first render pays for module warm-up; keep CI on a loaded machine from timing out.
jest.setTimeout(30_000);

afterEach(() => jest.useRealTimers());

describe("ShoppingScreen HUD", () => {
  it("shows progress, the cart count and Done over the 3D aisle", async () => {
    await renderWithProviders(<ShoppingScreen />);
    expect(await screen.findByText("Shopping · 0 of 3")).toBeTruthy();
    expect(screen.getByTestId("shopping-cart-count")).toBeTruthy();
    expect(screen.getByText("0 in cart")).toBeTruthy();
    expect(screen.getByLabelText("Leave shopping mode")).toBeTruthy();
    expect(screen.getByLabelText("Show as a list")).toBeTruthy();
    expect(screen.getByTestId("shopping-done")).toBeTruthy();
  });

  it("Scan opens the camera sheet with the list; a scanned row joins the cart and moves to the pantry on Done", async () => {
    await renderWithProviders(<ShoppingScreen />);
    await screen.findByText("Shopping · 0 of 3");
    expect(screen.queryByTestId("scan-sheet")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Scan a product"));
    expect(screen.getByText("scan shopping · 3 rows")).toBeTruthy();
    // the real sheet saves the check itself, then reports the row
    list[0].checked = true;
    await fireEvent.press(screen.getByText("fake scan first row"));
    await fireEvent.press(screen.getByText("close scan"));
    expect(screen.queryByTestId("scan-sheet")).toBeNull();
    await fireEvent.press(screen.getByTestId("shopping-done"));
    await waitFor(() => expect(completes).toBe(1));
    expect(patches).toEqual([]); // the screen never re-sent the check
  });

  it("no Scan button when scanning is turned off", async () => {
    await renderWithProviders(<ShoppingScreen scan={false} />);
    await screen.findByText("Shopping · 0 of 3");
    expect(screen.queryByLabelText("Scan a product")).toBeNull();
  });

  it("shows an error with retry when the list can't load", async () => {
    (api as jest.Mock).mockRejectedValueOnce(new Error("Network down"));
    await renderWithProviders(<ShoppingScreen />);
    expect(await screen.findByTestId("shopping-error")).toBeTruthy();
    await fireEvent.press(screen.getByText(/try again|retry/i));
    expect(await screen.findByText("Shopping · 0 of 3")).toBeTruthy();
  });

  it("shows the empty state for an empty list", async () => {
    list = [];
    mockServer();
    await renderWithProviders(<ShoppingScreen />);
    expect(await screen.findByTestId("shopping-empty")).toBeTruthy();
    expect(screen.getByText("Nothing to buy")).toBeTruthy();
  });

  it("checklist: allergen chips name member and allergen; check-off saves at once and completes after the grace", async () => {
    await renderWithProviders(<ShoppingScreen />);
    await screen.findByText("Shopping · 0 of 3");
    await fireEvent.press(screen.getByLabelText("Show as a list"));
    expect(screen.getByText("! Contains sesame · Ann")).toBeTruthy();
    expect(screen.getByText("! Contains milk · you")).toBeTruthy();

    jest.useFakeTimers();
    await fireEvent.press(screen.getByLabelText("Check off Bananas"));
    await waitFor(() => expect(patches).toEqual([{ id: list[0].id, checked: true }]));
    expect(screen.getByText("Shopping · 1 of 3")).toBeTruthy();
    expect(screen.getByText("Bananas is in the cart")).toBeTruthy();
    expect(completes).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(4100);
    });
    await waitFor(() => expect(completes).toBe(1));
    await waitFor(() => expect(screen.getByText("Added 1 item to your pantry")).toBeTruthy());
    // still counted as done this trip after the row leaves the list
    await waitFor(() => expect(screen.getByText("Shopping · 1 of 3")).toBeTruthy());
  });

  it("Undo puts the item back and nothing is completed", async () => {
    await renderWithProviders(<ShoppingScreen />);
    await screen.findByText("Shopping · 0 of 3");
    await fireEvent.press(screen.getByLabelText("Show as a list"));
    jest.useFakeTimers();
    await fireEvent.press(screen.getByLabelText("Check off Bananas"));
    await waitFor(() => expect(patches).toHaveLength(1));
    await fireEvent.press(screen.getByLabelText("Undo"));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ id: list[0].id, checked: false });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(completes).toBe(0);
  });

  it("leftover checked rows (closed app) complete on Done, and Done leaves the screen", async () => {
    list[0].checked = true;
    mockServer();
    await renderWithProviders(<ShoppingScreen />);
    expect(await screen.findByText("Shopping · 1 of 3")).toBeTruthy();
    expect(screen.getByText("1 in cart")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("shopping-done"));
    await waitFor(() => expect(completes).toBe(1));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("completes immediately when the app goes to the background", async () => {
    const listeners: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_t, fn) => {
      listeners.push(fn as (s: string) => void);
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    await renderWithProviders(<ShoppingScreen />);
    await screen.findByText("Shopping · 0 of 3");
    await fireEvent.press(screen.getByLabelText("Show as a list"));
    await fireEvent.press(screen.getByLabelText("Check off Bananas"));
    await waitFor(() => expect(patches).toHaveLength(1));
    await act(async () => listeners.forEach((l) => l("background")));
    await waitFor(() => expect(completes).toBe(1));
    spy.mockRestore();
  });

  it("completes on unmount (Back) without waiting for the grace", async () => {
    const { unmount } = await renderWithProviders(<ShoppingScreen />);
    await screen.findByText("Shopping · 0 of 3");
    await fireEvent.press(screen.getByLabelText("Show as a list"));
    await fireEvent.press(screen.getByLabelText("Check off Milk"));
    await waitFor(() => expect(patches).toHaveLength(1));
    await act(async () => unmount());
    await waitFor(() => expect(completes).toBe(1));
  });
});
