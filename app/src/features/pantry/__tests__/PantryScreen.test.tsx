import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "@/test-utils";

import { setRanOutPrompt } from "@/features/cabinet/ranOutStore";

import { PantryScreen } from "../PantryScreen";

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
// The 3D scene can't run under Jest (no WebGL, three.js is ESM); the screen's RN shell and phase/overlay logic can.
jest.mock("three", () => ({
  Plane: class {},
  Vector3: class {},
  MathUtils: { clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)) },
}));
jest.mock("@react-three/fiber", () => ({ useFrame: jest.fn(), useThree: jest.fn() }));
jest.mock("../scene/PantryCanvas", () => ({ PantryCanvas: () => null }));
jest.mock("../scene/CameraRig", () => ({ CameraRig: () => null }));
jest.mock("../scene/Lights", () => ({ Lights: () => null }));
jest.mock("../scene/exterior/PantryExterior", () => ({ PantryExterior: () => null }));
jest.mock("../scene/shelves", () => ({ ...require("../scene/shelves/layout"), ShelfColumn: () => null }));
jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = new Proxy({}, { get: () => () => chain });
  return { GestureDetector: ({ children }: { children: React.ReactNode }) => children, Gesture: { Pan: () => chain } };
});
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));

const mockPantry = {
  sections: [],
  items: [],
  myAllergens: [],
  listPreview: [],
  isLoading: false,
  error: null as Error | null,
  refetch: () => {
    mockPantry.refetched += 1;
  },
  refetched: 0,
};
jest.mock("../data", () => ({ usePantry: () => mockPantry }));

beforeEach(() => {
  mockPantry.refetched = 0;
  mockPantry.isLoading = false;
  mockPantry.error = null;
});

describe("PantryScreen shell", () => {
  it("starts closed with an accessible open button and no shelf overlays", async () => {
    await renderWithProviders(<PantryScreen />);
    expect(screen.getByLabelText("Open pantry")).toBeTruthy();
    expect(screen.queryByTestId("pantry-search-button")).toBeNull();
    expect(screen.queryByTestId("pantry-filter-button")).toBeNull();
    expect(screen.queryByTestId("pantry-back-button")).toBeNull();
  });

  it("tapping open starts the opening phase (open button goes away, overlays wait for the shelves)", async () => {
    await renderWithProviders(<PantryScreen />);
    await fireEvent.press(screen.getByLabelText("Open pantry"));
    expect(screen.queryByLabelText("Open pantry")).toBeNull();
    expect(screen.queryByTestId("pantry-search-button")).toBeNull();
  });

  it("shows a loading indicator while the cabinet loads", async () => {
    mockPantry.isLoading = true;
    await renderWithProviders(<PantryScreen />);
    expect(screen.getByTestId("pantry-loading")).toBeTruthy();
  });

  it("shows an error with retry", async () => {
    mockPantry.error = new Error("Network down");
    await renderWithProviders(<PantryScreen />);
    expect(screen.getByTestId("pantry-error")).toBeTruthy();
    await fireEvent.press(screen.getByText(/try again|retry/i));
    expect(mockPantry.refetched).toBe(1);
  });

  it("keeps the old Cabinet tools reachable: list view switch, and the ran-out prompt", async () => {
    const onShowList = jest.fn();
    await renderWithProviders(<PantryScreen onShowList={onShowList} />);
    await fireEvent.press(screen.getByTestId("pantry-listview-button"));
    expect(onShowList).toHaveBeenCalled();

    await renderWithProviders(<PantryScreen />);
    expect(screen.queryByTestId("ranout-prompt")).toBeNull();
    // "Ran out" on the item screen (or a quick action) sets this; the Pantry must show it again.
    setRanOutPrompt({ id: "c1", item: { id: "i1", name: "Oat Milk", category: "dairy" } } as never);
    expect(await screen.findByText(/Nobody has Oat Milk in their preferences/)).toBeTruthy();
    setRanOutPrompt(null);
  });
});
