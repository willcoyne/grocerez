import { act, fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders, testUser } from "@/test-utils";

import { setRanOutPrompt } from "@/features/cabinet/ranOutStore";
import { disposeThemeCaches } from "@/features/theme/materials";

import { PantryScreen } from "../PantryScreen";
import { requestStation, resetRoomNav } from "../roomNav";
import type { PantryItem, ShelfSection } from "../types";

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
// The 3D scene can't run under Jest (no WebGL, three.js is ESM); the screen's RN shell and phase/overlay logic can.
jest.mock("three", () => ({
  Plane: class {},
  Vector3: class {},
  MathUtils: { clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)) },
}));
// useFrame callbacks are collected so a test can drive the render loop (PhaseDriver, ExteriorMount) frame by frame.
jest.mock("@react-three/fiber", () => {
  const React = require("react");
  const frames = new Set<(mockState: unknown, mockDt: number) => void>();
  return {
    __frames: frames,
    useThree: jest.fn(),
    useFrame: (cb: (mockState: unknown, mockDt: number) => void) => {
      const ref = React.useRef(cb);
      ref.current = cb;
      React.useEffect(() => {
        const f = (s: unknown, dt: number) => ref.current(s, dt);
        frames.add(f);
        return () => frames.delete(f);
      }, []);
    },
  };
});
jest.mock("../scene/PantryCanvas", () => ({
  PantryCanvas: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../scene/CameraRig", () => ({
  CameraRig: (p: { station?: string | null; onArrive?: (s: string | null) => void }) => {
    mockRig.props = p;
    return null;
  },
}));
jest.mock("../RoomLayer", () => ({
  RoomLayer: (p: { onStation: (id: string) => void; disabled: boolean }) => {
    mockRoom.props = p;
    return null;
  },
}));
jest.mock("../useRoomData", () => ({
  useRoomData: () => ({
    picks: [],
    displayName: "Me",
    avatarInitial: "M",
    members: [],
    inviteCount: 0,
    alertCount: 0,
    monthLabel: "October",
    today: new Date(0),
  }),
}));
// Station sheets / scan sheet are tested in their own features; here: which one opens, and what closing does.
jest.mock("@/features/stations", () => {
  const { createElement: h } = require("react");
  const { Pressable: P, Text: T, View: V } = require("react-native");
  const sheet = (id: string) => (p: { visible: boolean; onClose: () => void; onOpenMealPrep?: () => void }) =>
    p.visible
      ? h(
          V,
          { testID: id },
          h(P, { accessibilityLabel: `Close ${id}`, onPress: p.onClose }, h(T, null, "close")),
          p.onOpenMealPrep ? h(P, { accessibilityLabel: "Plan meals", onPress: p.onOpenMealPrep }, h(T, null, "plan")) : null,
        )
      : null;
  return { HouseholdSheet: sheet("household-sheet") };
});
// The Me and Week papers are tested in their own features; here only when they open and what closing does.
jest.mock("@/features/me/MeSheet", () => {
  const { createElement: h } = require("react");
  const { Pressable: P, Text: T, View: V } = require("react-native");
  return {
    MeSheet: (p: { visible: boolean; onClose: () => void }) =>
      p.visible ? h(V, { testID: "me-note" }, h(P, { accessibilityLabel: "Close me-note", onPress: p.onClose }, h(T, null, "close"))) : null,
  };
});
jest.mock("@/features/week/WeekSheet", () => {
  const { createElement: h } = require("react");
  const { Pressable: P, Text: T, View: V } = require("react-native");
  return {
    WeekSheet: (p: { visible: boolean; onClose: () => void }) =>
      p.visible ? h(V, { testID: "week-note" }, h(P, { accessibilityLabel: "Close week-note", onPress: p.onClose }, h(T, null, "close"))) : null,
  };
});
jest.mock("@/features/scan", () => {
  const { createElement: h } = require("react");
  const { Text: T } = require("react-native");
  return {
    ScanSheet: (p: { visible: boolean; context: { kind: string } }) =>
      p.visible ? h(T, { testID: "scan-sheet" }, `scan ${p.context.kind}`) : null,
  };
});
jest.mock("@/features/theme/materials", () => ({ disposeThemeCaches: jest.fn() }));
jest.mock("@/features/theme/ThemeProvider", () => {
  const { useSyncExternalStore } = require("react");
  const { getTheme } = require("@/features/theme/registry");
  const useThemeId = () => useSyncExternalStore(mockTheme.subscribe, () => mockTheme.id);
  return { useThemeId, useSceneTheme: () => getTheme(useThemeId()), useThemeUi: () => getTheme(useThemeId()).ui };
});
jest.mock("../scene/Lights", () => ({ Lights: () => null }));
jest.mock("../scene/exterior/PantryExterior", () => ({
  PantryExterior: (p: { onListPress?: () => void; listProgress?: number }) => {
    mockExterior.props = p;
    return null;
  },
}));
jest.mock("../scene/shelves", () => ({
  ...require("../scene/shelves/layout"),
  ShelfColumn: (p: Record<string, unknown>) => {
    mockShelf.props = p;
    return null;
  },
}));
// The note's own behaviour is covered in ShoppingListNote.test.tsx; here we only care when it opens and what it calls.
jest.mock("../overlay/ShoppingListNote", () => {
  const { createElement: h } = require("react");
  const { Pressable: P, Text: T, View: V } = require("react-native");
  return {
    ShoppingListNote: (p: { visible: boolean; onClose: () => void }) =>
      p.visible
        ? h(V, { testID: "list-note" }, h(P, { accessibilityLabel: "Close shopping list", onPress: p.onClose }, h(T, null, "close")))
        : null,
  };
});
jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = new Proxy({}, { get: () => () => chain });
  return { GestureDetector: ({ children }: { children: React.ReactNode }) => children, Gesture: { Pan: () => chain } };
});
/* eslint-enable @typescript-eslint/no-require-imports */
const mockPush = jest.fn();
const mockSetParams = jest.fn();
const mockParams: { station?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
}));

const mockRig: { props: { station?: string | null; onArrive?: (s: string | null) => void } } = { props: {} };
const mockRoom: { props: { onStation?: (id: string) => void; disabled?: boolean } } = { props: {} };
const mockTheme = {
  id: "cozy",
  listeners: new Set<() => void>(),
  subscribe(l: () => void) {
    mockTheme.listeners.add(l);
    return () => mockTheme.listeners.delete(l);
  },
  set(id: string) {
    mockTheme.id = id;
    mockTheme.listeners.forEach((l) => l());
  },
};

const mockExterior: { props: { onListPress?: () => void; listProgress?: number; liftedNote?: string } } = { props: {} };
const mockShelf: { props: Record<string, unknown> } = { props: {} };

const milk = {
  id: "row-milk",
  itemId: "item-milk",
  name: "Milk",
  brand: null,
  category: "dairy",
  location: "fridge",
  group: "fridge",
  allergens: ["milk"],
  status: "in_stock",
  expiresAt: null,
  caloriesPerServing: null,
  healthScore: null,
  imageUrl: null,
  ingredients: null,
  servingSize: null,
} as PantryItem;

const mockPantry = {
  sections: [] as ShelfSection[],
  items: [] as PantryItem[],
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

/** Run `seconds` of the render loop in 0.1 s frames. */
async function tick(seconds: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const frames: Set<(s: unknown, dt: number) => void> = require("@react-three/fiber").__frames;
  const state = { camera: { layers: { mask: 0 } }, clock: { elapsedTime: 0 } };
  for (let t = 0; t < seconds; t += 0.1) {
    await act(async () => {
      for (const f of [...frames]) f(state, 0.1);
    });
  }
}

beforeEach(() => {
  mockPantry.refetched = 0;
  mockPantry.isLoading = false;
  mockPantry.error = null;
  mockPantry.sections = [];
  mockPantry.items = [];
  mockPush.mockReset();
  mockShelf.props = {};
  mockExterior.props = {};
  mockRig.props = {};
  mockRoom.props = {};
  mockSetParams.mockReset();
  delete mockParams.station;
  resetRoomNav();
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

describe("pinned shopping list", () => {
  it("tapping the note flies to it, lifts the paper, then opens the list; closing puts it back", async () => {
    await renderWithProviders(<PantryScreen />);
    expect(mockExterior.props.onListPress).toEqual(expect.any(Function));

    await act(async () => mockExterior.props.onListPress!());
    // In flight: doors stay shut (no open pill, no shelves), the overlay waits for the paper to arrive.
    expect(screen.queryByLabelText("Open pantry")).toBeNull();
    expect(screen.queryByTestId("list-note")).toBeNull();

    await tick(0.7);
    expect(mockExterior.props.listProgress).toBeGreaterThan(0);
    expect(screen.queryByTestId("list-note")).toBeNull();

    await tick(1);
    expect(mockExterior.props.listProgress).toBe(1);
    expect(screen.getByTestId("list-note")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Close shopping list"));
    expect(screen.queryByTestId("list-note")).toBeNull();
    await tick(1.6);
    expect(mockExterior.props.listProgress).toBe(0);
    expect(screen.getByLabelText("Open pantry")).toBeTruthy();
  });

  it("with the user's fast setting there is no flight: the list opens on the next frame", async () => {
    await renderWithProviders(<PantryScreen />, { auth: { user: { ...testUser, motion: "fast" } } });
    await act(async () => mockExterior.props.onListPress!());
    await tick(0.1);
    expect(screen.getByTestId("list-note")).toBeTruthy();
  });

  it("has an accessible List button that does the same as tapping the note", async () => {
    await renderWithProviders(<PantryScreen />);
    await fireEvent.press(screen.getByLabelText("Shopping list"));
    await tick(1.6);
    expect(screen.getByTestId("list-note")).toBeTruthy();
  });
});

describe("item selection on the shelves", () => {
  async function openShelves() {
    mockPantry.items = [milk];
    mockPantry.sections = [{ group: "fridge", label: "FRIDGE", items: [milk] }];
    await renderWithProviders(<PantryScreen />);
    await fireEvent.press(screen.getByLabelText("Open pantry"));
    await tick(3.2); // opening 1.6 s + zooming 1.2 s
    expect(screen.getByTestId("pantry-back-button")).toBeTruthy();
  }

  it("tapping an item flips + highlights it and shows a Details pill instead of navigating", async () => {
    await openShelves();
    const press = mockShelf.props.onItemPress as (i: PantryItem) => void;
    await act(async () => press(milk));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockShelf.props.flippedId).toBe(milk.id);
    expect(mockShelf.props.highlightId).toBe(milk.id);

    await fireEvent.press(screen.getByLabelText("Details for Milk"));
    expect(mockPush).toHaveBeenCalledWith("/item-detail/row-milk");
  });

  it("tapping the same item again unflips it and hides the pill", async () => {
    await openShelves();
    await act(async () => (mockShelf.props.onItemPress as (i: PantryItem) => void)(milk));
    await act(async () => (mockShelf.props.onItemPress as (i: PantryItem) => void)(milk));
    expect(mockShelf.props.flippedId).toBeNull();
    expect(screen.queryByTestId("pantry-details-button")).toBeNull();
  });

  it("Back clears the selection", async () => {
    await openShelves();
    await act(async () => (mockShelf.props.onItemPress as (i: PantryItem) => void)(milk));
    await fireEvent.press(screen.getByTestId("pantry-back-button"));
    expect(mockShelf.props.flippedId).toBeNull();
    expect(screen.queryByTestId("pantry-details-button")).toBeNull();
  });
});

describe("one-room navigation (stations)", () => {
  /** The rig reports the end of its glide (the real one does it from the render loop). */
  async function arrive(station: string | null) {
    await act(async () => mockRig.props.onArrive!(station));
  }
  /** Queued station moves start on the next tick. */
  async function flush() {
    await act(() => new Promise((r) => setTimeout(r, 0)));
  }

  it("a nav request glides to the station, opens its sheet on arrival, and closing returns to the pantry view", async () => {
    await renderWithProviders(<PantryScreen />);
    expect(mockRig.props.station).toBeNull();
    await act(async () => requestStation("household"));
    expect(mockRig.props.station).toBe("household");
    expect(screen.queryByTestId("household-sheet")).toBeNull(); // still flying
    expect(screen.queryByLabelText("Open pantry")).toBeNull(); // pantry pills hide while away
    expect(mockRoom.props.disabled).toBe(true);

    await arrive("household");
    expect(screen.getByTestId("household-sheet")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Close household-sheet"));
    expect(screen.queryByTestId("household-sheet")).toBeNull();
    expect(mockRig.props.station).toBeNull();
    await arrive(null);
    expect(screen.getByLabelText("Open pantry")).toBeTruthy();
    expect(mockRoom.props.disabled).toBe(false);
  });

  it("tapping room props goes to their stations: cork board -> Household, scanner -> lookup scan", async () => {
    await renderWithProviders(<PantryScreen />);
    await act(async () => mockRoom.props.onStation!("household"));
    await arrive("household");
    expect(screen.getByTestId("household-sheet")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Close household-sheet"));
    await arrive(null);

    await act(async () => mockRoom.props.onStation!("scan"));
    expect(mockRig.props.station).toBe("scan");
    await arrive("scan");
    expect(screen.getByTestId("scan-sheet").props.children).toBe("scan lookup");
  });

  it("the Me and Week tabs fly to their papers on the pantry (no station glide) and open them", async () => {
    await renderWithProviders(<PantryScreen />);
    for (const [id, testID] of [["me", "me-note"], ["week", "week-note"]] as const) {
      await act(async () => requestStation(id));
      expect(mockRig.props.station).toBeNull();
      expect(mockExterior.props.liftedNote).toBe(id);
      await tick(1.6);
      expect(screen.getByTestId(testID)).toBeTruthy();
      await fireEvent.press(screen.getByLabelText(`Close ${testID}`));
      await tick(1.6);
      expect(screen.getByLabelText("Open pantry")).toBeTruthy();
    }
  });

  it("the List tab from a station goes back to the pantry framing, then flies to the note", async () => {
    await renderWithProviders(<PantryScreen />);
    await act(async () => requestStation("household"));
    await arrive("household");
    expect(screen.getByTestId("household-sheet")).toBeTruthy();
    await act(async () => requestStation("list"));
    expect(screen.queryByTestId("household-sheet")).toBeNull();
    expect(mockRig.props.station).toBeNull();
    await arrive(null);
    await flush();
    await tick(1.6);
    expect(screen.getByTestId("list-note")).toBeTruthy();
  });

  it("a station request from inside the shelves closes the pantry first; props are not tappable in the shelves", async () => {
    mockPantry.items = [milk];
    mockPantry.sections = [{ group: "fridge", label: "FRIDGE", items: [milk] }];
    await renderWithProviders(<PantryScreen />);
    await fireEvent.press(screen.getByLabelText("Open pantry"));
    await tick(3.2);
    expect(screen.getByTestId("pantry-back-button")).toBeTruthy();
    expect(mockRoom.props.disabled).toBe(true);

    await act(async () => requestStation("household"));
    // the glide back to the top shelf runs on a real timer before the doors close
    await act(() => new Promise((r) => setTimeout(r, 600)));
    await tick(3);
    await flush();
    expect(mockRig.props.station).toBe("household");
    await arrive("household");
    expect(screen.getByTestId("household-sheet")).toBeTruthy();
  });

  it("deep links (/cabinet?station=list) open that station and clear the param", async () => {
    mockParams.station = "list";
    await renderWithProviders(<PantryScreen />);
    expect(mockSetParams).toHaveBeenCalledWith({ station: undefined });
    await tick(1.6);
    expect(screen.getByTestId("list-note")).toBeTruthy();
  });

  it("a theme switch disposes the previous theme's material caches", async () => {
    await renderWithProviders(<PantryScreen />);
    await act(async () => mockTheme.set("neon"));
    expect(disposeThemeCaches).toHaveBeenCalledWith("cozy");
    await act(async () => mockTheme.set("cozy"));
  });
});
