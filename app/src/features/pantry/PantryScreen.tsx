/* eslint-disable react/no-unknown-property -- R3F JSX props (position, scale, ...) are valid three.js props */
/* eslint-disable react-hooks/immutability -- three.js objects (camera, scene graph, materials) are mutated in useFrame by design */
/**
 * Pantry home screen: a full-screen React Three Fiber scene with React Native overlays (SPEC.md).
 *
 * WORLD FRAME
 * The scene's world frame IS the exterior frame (scene/exterior): pantry front face centred at x = 0, floor at y = 0,
 * front face at z = 0, interior opening x∈[-0.85, 0.85], y∈[0.15, 2.95], z∈[-0.85, 0].
 * The shelf column (scene/shelves, its own frame: centred at x = 0, top of the first section at y = 0 growing DOWN,
 * shelf front edge at z = 0) is mounted inside the pantry with a pure translation, SHELF_ORIGIN:
 *
 *     world = shelfLocal + SHELF_ORIGIN,   SHELF_ORIGIN = [0, 2.9, -0.3]   (no rotation, scale 1)
 *
 * so the top shelf sits just under the opening's top edge (y 2.95) and the shelf fronts are 0.3 behind the doors
 * (the 0.44-deep boards end at z -0.74, inside the 0.85-deep body; the wall is at z -0.95). The column is 1.7 wide,
 * exactly the opening. Until the camera is inside (`shelves` phase) the column is clipped to the opening box, so its
 * "endless" filler shelves never poke out above/below the pantry; in `shelves` the exterior is hidden instead.
 *
 * PHASES  closed → (tap pantry) opening 1.6 s → zooming 1.2 s → shelves → (Back) closing → closed.
 *         closed → (tap the pinned list) list: camera flies to the note, the paper lifts off its pin (clock.list 0→1),
 *         then the ShoppingListNote overlay opens; closing it runs clock.list 1→0 and returns to closed.
 * ITEMS   Tapping a food item selects it (tap again / scroll / Back clears): the camera flies to it, the item flips to
 *         show its back label (ShelfColumn flippedId) and a "Details" pill links to /item-detail/[id].
 * Progress lives in a mutable PhaseClock advanced by <PhaseDriver/> inside the render loop (no per-frame React
 * renders of this screen); the exterior gets an eased `openProgress` from a tiny wrapper that re-renders only itself.
 * Reduced motion: doors take 0.3 s and the camera cuts instead of dollying.
 *
 * INTERACTION LAYERS  Objects on layer 0 receive R3F pointer events; the camera renders layers 0+1. A subtree that
 * must be visible but not tappable (the shelves behind closed doors) is moved to layer 1 each frame by useSceneMask.
 */
import { useFrame } from "@react-three/fiber";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, BackHandler, Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as THREE from "three";

import { errorMessage } from "@/api/client";
import { useCabinet } from "@/api/hooks/cabinet";
import { useMealPlan } from "@/api/hooks/mealPlan";
import { AppText, Button, ErrorState } from "@/components/ui";
import { useCabinetActions } from "@/components/useCabinetActions";
import { MapOutPicker } from "@/features/cabinet/CabinetScreen";
import { RanOutPrompt } from "@/features/cabinet/RanOutPrompt";
import { useRanOutPrompt } from "@/features/cabinet/ranOutStore";
import { WeekSheet } from "@/features/week/WeekSheet";
import { weekPreviewLines } from "@/features/week/weekDates";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";

import { usePantry } from "./data";
import { activeFilterCount, applyFilters } from "./filters";
import { BackButton, FilterButton, FilterSheet, SearchButton, SearchPanel, ShoppingListNote, ToolButtons } from "./overlay";
import { pantry as palette, softShadow } from "./overlay/palette";
import { CameraRig, type CameraFocus, type PhaseClock, type Vec3 } from "./scene/CameraRig";
import { PANTRY_DIMENSIONS } from "./scene/exterior/dimensions";
import { PantryExterior } from "./scene/exterior/PantryExterior";
import { Lights } from "./scene/Lights";
import { PantryCanvas } from "./scene/PantryCanvas";
import { itemWorldPosition, ShelfColumn, totalHeight } from "./scene/shelves";
import { easeInOutCubic, useShelfScroll } from "./scene/useShelfScroll";
import { EMPTY_FILTERS, type PantryFilters, type PantryItem, type PantryPhase } from "./types";

/** Shelf-column origin in exterior/world coordinates (see header). */
export const SHELF_ORIGIN: Vec3 = [0, 2.9, -0.3];

/** Phase timings in seconds. */
export const DURATIONS = {
  normal: { open: 1.6, zoom: 1.2, pull: 1.1, doorDelay: 0.35, doorClose: 1.1, list: 1.4 },
  reduced: { open: 0.3, zoom: 0, pull: 0, doorDelay: 0, doorClose: 0.3, list: 0 },
} as const;
type Durations = (typeof DURATIONS)["normal" | "reduced"];

const NEXT_PHASE: Partial<Record<PantryPhase, PantryPhase>> = {
  opening: "zooming",
  zooming: "shelves",
  closing: "closed",
  list: "closed", // after the note has gone back on its pin
};

/** How long a searched item stays highlighted (ms). */
const HIGHLIGHT_MS = 8000;

const { opening: OPENING } = PANTRY_DIMENSIONS;
/** World-space clip box = the pantry opening (three.js keeps points with n·p + c ≥ 0). */
const OPENING_CLIP = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), -OPENING.minX),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), OPENING.maxX),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), -OPENING.minY),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), OPENING.maxY),
];
const LAYER_INTERACTIVE = 1 << 0;
const LAYER_PASSIVE = 1 << 1;

export type PantryScreenProps = {
  /**
   * Opens the Week sheet (spec §13) when it changes to a new non-empty value: other tabs navigate here with a fresh
   * `?week=<nonce>` ("Plan our week" on Household, "Plan meals" in alerts).
   */
  weekSignal?: string;
  /** Switches the Pantry tab to the cabinet list view (CabinetScreen), which has every cabinet action. */
  onShowList?: () => void;
};

export function PantryScreen({ weekSignal, onShowList }: PantryScreenProps = {}) {
  const groupId = useRequiredGroupId();
  const cabinet = useCabinet(groupId);
  const actions = useCabinetActions(groupId);
  const ranOutPrompt = useRanOutPrompt();
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const scan = useCallback(() => router.push("/scanner?mode=add-to-cabinet"), [router]);
  const data = usePantry(groupId);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const durations = reducedMotion ? DURATIONS.reduced : DURATIONS.normal;

  const [phase, setPhase] = useState<PantryPhase>("closed");
  const [leaving, setLeaving] = useState(false);
  const [focused, setFocused] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<PantryFilters>(EMPTY_FILTERS);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** Tapped item: flipped to its back label, camera framed on it, "Details" pill shown. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** ShoppingListNote overlay is open (after the fly-to + lift in the `list` phase). */
  const [listOpen, setListOpen] = useState(false);
  /** The Week sheet (spec §13) is open; it sits over the closed pantry, under the pinned Week note. */
  const [weekOpen, setWeekOpen] = useState(false);
  const [seenWeekSignal, setSeenWeekSignal] = useState<string | undefined>(undefined);
  if (weekSignal && weekSignal !== seenWeekSignal) {
    setSeenWeekSignal(weekSignal);
    setWeekOpen(true);
  }
  const mealPlan = useMealPlan(groupId);
  const weekPreview = useMemo(() => weekPreviewLines(mealPlan.data), [mealPlan.data]);

  const clock = useRef<PhaseClock>({ open: 0, zoom: 0, list: 0 });
  /** `list` phase direction: +1 flying to the note, -1 putting it back. */
  const listDir = useRef<1 | -1>(1);
  const focus = useRef<CameraFocus>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scroll = useShelfScroll({ enabled: phase === "shelves" && !searchOpen && !filterOpen, reducedMotion });

  const { sections, items, myAllergens, listPreview } = data;
  const contentHeight = useMemo(() => totalHeight(sections), [sections]);

  // Filters dim (not remove) items so the shelf layout never jumps.
  const filterCount = activeFilterCount(filters);
  const visibleIds = useMemo(
    () => (filterCount > 0 ? applyFilters(items, filters, myAllergens).visible : null),
    [items, filters, myAllergens, filterCount],
  );
  const dim = useCallback((item: PantryItem) => (visibleIds ? !visibleIds.has(item.id) : false), [visibleIds]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const clearFocus = useCallback(() => {
    focus.current = null;
    setHighlightId(null);
    setSelectedId(null);
  }, []);
  useEffect(() => {
    scroll.onUserScroll.current = clearFocus;
  }, [scroll.onUserScroll, clearFocus]);

  // Switching households: never keep another group's highlight, and start at the top of the column.
  const [seenGroup, setSeenGroup] = useState(groupId);
  if (seenGroup !== groupId) {
    setSeenGroup(groupId);
    setHighlightId(null);
    setSelectedId(null);
    setSearchOpen(false);
  }
  const { scrollTo } = scroll;
  useEffect(() => {
    focus.current = null;
    scrollTo(0, { animated: false });
  }, [groupId, scrollTo]);

  // Pause rendering while another tab is showing.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const openPantry = useCallback(() => {
    setPhase((p) => {
      if (p !== "closed") return p;
      clock.current.open = 0;
      clock.current.zoom = 0;
      return "opening";
    });
    clearFocus();
    scroll.scrollTo(0, { animated: false }); // clamps to the top bound
  }, [clearFocus, scroll]);

  const openList = useCallback(() => {
    setPhase((p) => {
      if (p !== "closed") return p;
      clock.current.list = 0;
      listDir.current = 1;
      return "list";
    });
  }, []);

  const closeList = useCallback(() => {
    setListOpen(false);
    listDir.current = -1;
  }, []);

  const onListArrived = useCallback(() => setListOpen(true), []);

  // The Week note opens its sheet straight over the closed pantry (no camera flight).
  const openWeek = useCallback(() => {
    if (phase === "closed") setWeekOpen(true);
  }, [phase]);

  const closePantry = useCallback(() => {
    if (phase !== "shelves" || leaving) return;
    setSearchOpen(false);
    setFilterOpen(false);
    clearFocus();
    // Glide back to the top shelf first so the pull-back starts from the doorway.
    const d = scroll.scrollTo(0, { duration: 0.45 });
    setLeaving(true);
    const go = () => {
      setLeaving(false);
      setPhase((p) => (p === "shelves" ? "closing" : p));
    };
    if (d > 0) timers.current.push(setTimeout(go, d * 1000));
    else go();
  }, [phase, leaving, clearFocus, scroll]);

  // Android hardware back closes panels, then the pantry.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (weekOpen) return setWeekOpen(false), true;
        if (phase === "list") return closeList(), true;
        if (searchOpen) return setSearchOpen(false), true;
        if (filterOpen) return setFilterOpen(false), true;
        if (selectedId) return clearFocus(), true;
        if (phase === "shelves") return closePantry(), true;
        return false;
      });
      return () => sub.remove();
    }, [searchOpen, filterOpen, phase, selectedId, closePantry, closeList, clearFocus, weekOpen]),
  );

  const advance = useCallback((from: PantryPhase) => {
    const next = NEXT_PHASE[from];
    if (next) setPhase((p) => (p === from ? next : p));
  }, []);

  /** Scroll + dolly the camera so `item` is centred and close (search fly-to, item tap). */
  const flyTo = useCallback(
    (item: PantryItem) => {
      const pos = itemWorldPosition(sections, item.id);
      if (!pos) return false;
      const centreY = pos[1] + 0.2; // visual centre of the item
      scroll.scrollTo(-centreY);
      focus.current = { x: pos[0], y: centreY };
      return true;
    },
    [sections, scroll],
  );

  const onSelectSearch = useCallback(
    (item: PantryItem) => {
      setSearchOpen(false);
      clearTimers();
      setSelectedId(null);
      if (!flyTo(item)) return;
      setHighlightId(item.id);
      timers.current.push(setTimeout(clearFocus, HIGHLIGHT_MS));
    },
    [flyTo, clearTimers, clearFocus],
  );

  // Item tap toggles the selection (flip + fly-to); it no longer navigates (SPEC round 2).
  const onItemPress = useCallback(
    (item: PantryItem) => {
      clearTimers();
      if (selectedId === item.id) {
        clearFocus();
        return;
      }
      setHighlightId(null);
      setSelectedId(item.id);
      flyTo(item);
    },
    [selectedId, flyTo, clearTimers, clearFocus],
  );
  // A selected row that disappears (deleted elsewhere, group switch) is simply not selected any more.
  const selectedItem = useMemo(
    () => (selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null),
    [items, selectedId],
  );

  /** The cabinet row behind the selected item, for the quick actions (running low / ran out). */
  const selectedRow = useMemo(
    () => (selectedItem ? (cabinet.data?.find((r) => r.id === selectedItem.id) ?? null) : null),
    [cabinet.data, selectedItem],
  );

  const inShelves = phase === "shelves" && !leaving;
  const isEmpty = !data.isLoading && !data.error && items.length === 0;

  return (
    <View style={styles.fill} testID="pantry-screen">
      <GestureDetector gesture={scroll.gesture}>
        <View style={styles.fill} collapsable={false}>
          <PantryCanvas active={focused} onWheel={scroll.onWheel} testID="pantry-canvas">
            <Lights />
            <PhaseDriver
              phase={phase}
              clock={clock}
              durations={durations}
              listDir={listDir}
              onDone={advance}
              onListArrived={onListArrived}
            />
            <CameraRig
              phase={phase}
              clock={clock}
              scroll={scroll}
              shelfOrigin={SHELF_ORIGIN}
              contentHeight={contentHeight}
              frame={PANTRY_DIMENSIONS.bounds}
              focus={focus}
            />
            <ExteriorMount
              phase={phase}
              clock={clock}
              listPreview={listPreview}
              onPress={openPantry}
              onListPress={openList}
              weekPreview={weekPreview}
              onWeekPress={openWeek}
            />
            <ShelvesMount phase={phase}>
              <ShelfColumn
                sections={sections}
                scrollY={scroll.scrollY}
                myAllergens={myAllergens}
                dim={dim}
                onItemPress={onItemPress}
                highlightId={selectedItem?.id ?? highlightId}
                flippedId={selectedItem?.id ?? null}
              />
            </ShelvesMount>
          </PantryCanvas>
        </View>
      </GestureDetector>

      {phase === "closed" ? (
        <View style={[styles.bottomCenter, styles.row]} pointerEvents="box-none">
          <Pressable
            testID="pantry-open-button"
            accessibilityRole="button"
            accessibilityLabel="Open pantry"
            accessibilityHint="Opens the pantry doors and shows your shelves"
            onPress={openPantry}
            style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          >
            <AppText variant="caption" weight="bold" style={styles.pillText}>
              Tap the pantry to open
            </AppText>
          </Pressable>
          <Pressable
            testID="pantry-list-button"
            accessibilityRole="button"
            accessibilityLabel="Shopping list"
            accessibilityHint="Opens the shopping list pinned on the pantry"
            onPress={openList}
            style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          >
            <AppText variant="caption" weight="bold" style={styles.pillText}>
              List
            </AppText>
          </Pressable>
          <Pressable
            testID="pantry-week-button"
            accessibilityRole="button"
            accessibilityLabel="Week plan"
            accessibilityHint={
              weekPreview.length ? `Opens the week's dinners. ${weekPreview.join(". ")}` : "Opens the week's dinners pinned on the pantry"
            }
            onPress={openWeek}
            style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          >
            <AppText variant="caption" weight="bold" style={styles.pillText}>
              Week
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {data.isLoading ? (
        <View style={[styles.topCenter, { top: insets.top + 16 }]} pointerEvents="none" testID="pantry-loading">
          <View style={styles.pill} accessibilityRole="progressbar" accessibilityLabel="Loading your pantry">
            <ActivityIndicator color={palette.oakDark} />
            <AppText variant="caption" weight="bold" style={styles.pillText}>
              Loading your pantry…
            </AppText>
          </View>
        </View>
      ) : null}

      {data.error ? (
        <View style={[styles.topCard, { top: insets.top + 76 }]} testID="pantry-error">
          <ErrorState message={errorMessage(data.error)} onRetry={() => void data.refetch()} />
        </View>
      ) : null}

      {inShelves && isEmpty ? (
        <View style={styles.emptyCard} testID="pantry-empty">
          <AppText weight="bold" center style={styles.pillText}>
            Nothing on the shelves yet
          </AppText>
          <AppText variant="caption" center color="muted">
            Scan a product to stock your pantry.
          </AppText>
          <View style={styles.row}>
            <Button label="Add items" size="sm" onPress={() => setAdding(true)} />
            <Button label="Scan a product" size="sm" variant="secondary" onPress={scan} />
          </View>
        </View>
      ) : null}

      {inShelves && selectedItem ? (
        <View style={[styles.bottomCenter, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
          {selectedRow ? (
            <View style={[styles.row, styles.quickRow]}>
              <Pressable
                testID="pantry-low-button"
                accessibilityRole="button"
                accessibilityLabel={selectedRow.status === "running_low" ? `${selectedItem.name} is back in stock` : `${selectedItem.name} is running low`}
                onPress={() => (selectedRow.status === "running_low" ? actions.backInStock(selectedRow) : actions.markLow(selectedRow))}
                style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
              >
                <AppText variant="caption" weight="bold" style={styles.pillText}>
                  {selectedRow.status === "running_low" ? "Back in stock" : "Running low"}
                </AppText>
              </Pressable>
              <Pressable
                testID="pantry-ranout-button"
                accessibilityRole="button"
                accessibilityLabel={`${selectedItem.name} ran out`}
                onPress={() => actions.ranOut(selectedRow)}
                style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
              >
                <AppText variant="caption" weight="bold" style={styles.pillText}>
                  Ran out
                </AppText>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            testID="pantry-details-button"
            accessibilityRole="button"
            accessibilityLabel={`Details for ${selectedItem.name}`}
            accessibilityHint="Opens the item's full details"
            onPress={() => router.push(`/item-detail/${selectedItem.id}`)}
            style={({ pressed }) => [styles.pill, styles.detailsPill, pressed && styles.pressed]}
          >
            <AppText variant="caption" weight="bold" style={styles.detailsText} numberOfLines={1}>
              {`Details · ${selectedItem.name}`}
            </AppText>
          </Pressable>
        </View>
      ) : null}

      <WeekSheet key={groupId} visible={weekOpen && phase === "closed"} groupId={groupId} onClose={() => setWeekOpen(false)} />

      <ShoppingListNote
        visible={phase === "list" && listOpen}
        groupId={groupId}
        onClose={closeList}
        // The 3D store (features/shopping) has no route yet, so "Start shopping" opens the List tab.
        onStartShopping={() => router.push("/list")}
      />

      {phase === "closed" || inShelves ? (
        <ToolButtons compact={phase === "closed"} onListView={onShowList} onAdd={() => setAdding(true)} onScan={scan} />
      ) : null}
      <MapOutPicker groupId={groupId} visible={adding} onClose={() => setAdding(false)} onScan={scan} />

      {ranOutPrompt && (phase === "closed" || inShelves) ? (
        <View style={[styles.topCard, styles.promptCard, { top: insets.top + 12 }]}>
          <RanOutPrompt
            name={ranOutPrompt.item.name}
            busy={actions.addingAnyway}
            onAdd={() => actions.addAnyway(ranOutPrompt)}
            onDismiss={() => actions.dismissRanOut(ranOutPrompt)}
          />
        </View>
      ) : null}

      {inShelves ? (
        <>
          <BackButton onPress={closePantry} />
          <SearchButton onPress={() => setSearchOpen(true)} />
          <FilterButton onPress={() => setFilterOpen(true)} activeCount={filterCount} />
          <SearchPanel
            visible={searchOpen}
            items={items}
            myAllergens={myAllergens}
            onSelect={onSelectSearch}
            onClose={() => setSearchOpen(false)}
          />
          <FilterSheet
            visible={filterOpen}
            filters={filters}
            onChange={setFilters}
            onClose={() => setFilterOpen(false)}
            myAllergens={myAllergens}
          />
        </>
      ) : null}
    </View>
  );
}

/** Advances the PhaseClock each frame and reports when a timed phase is done. */
function PhaseDriver({
  phase,
  clock,
  durations,
  listDir,
  onDone,
  onListArrived,
}: {
  phase: PantryPhase;
  clock: MutableRefObject<PhaseClock>;
  durations: Durations;
  listDir: MutableRefObject<1 | -1>;
  onDone: (phase: PantryPhase) => void;
  /** the note has reached the camera: open the list overlay */
  onListArrived: () => void;
}) {
  const t = useRef({ phase, elapsed: 0, arrived: false });
  useFrame((_, raw) => {
    const dt = Math.min(raw, 1 / 10);
    if (t.current.phase !== phase) t.current = { phase, elapsed: 0, arrived: false };
    const c = clock.current;
    const d = durations;
    switch (phase) {
      case "closed":
        c.open = 0;
        c.zoom = 0;
        c.list = 0;
        break;
      case "list": {
        c.open = 0;
        c.zoom = 0;
        const step = d.list > 0 ? dt / d.list : 1;
        if (listDir.current > 0) {
          c.list = Math.min(1, c.list + step);
          if (c.list >= 1 && !t.current.arrived) {
            t.current.arrived = true;
            onListArrived();
          }
        } else {
          c.list = Math.max(0, c.list - step);
          if (c.list <= 0) onDone("list");
        }
        break;
      }
      case "opening":
        c.zoom = 0;
        c.open = d.open > 0 ? Math.min(1, c.open + dt / d.open) : 1;
        if (c.open >= 1) onDone("opening");
        break;
      case "zooming":
        c.open = 1;
        c.zoom = d.zoom > 0 ? Math.min(1, c.zoom + dt / d.zoom) : 1;
        if (c.zoom >= 1) onDone("zooming");
        break;
      case "shelves":
        c.open = 1;
        c.zoom = 1;
        break;
      case "closing": {
        const e = (t.current.elapsed += dt);
        c.zoom = d.pull > 0 ? Math.max(0, 1 - e / d.pull) : 0;
        c.open = d.doorClose > 0 ? 1 - THREE.MathUtils.clamp((e - d.doorDelay) / d.doorClose, 0, 1) : 0;
        if (c.zoom <= 0 && c.open <= 0) onDone("closing");
        break;
      }
    }
  });
  return null;
}

/** Exterior with an eased openProgress; re-renders only itself while the doors move. */
function ExteriorMount({
  phase,
  clock,
  listPreview,
  onPress,
  onListPress,
  weekPreview,
  onWeekPress,
}: {
  phase: PantryPhase;
  clock: MutableRefObject<PhaseClock>;
  listPreview: string[];
  onPress: () => void;
  onListPress: () => void;
  weekPreview: string[];
  onWeekPress: () => void;
}) {
  const [openProgress, setOpenProgress] = useState(0);
  const [listProgress, setListProgress] = useState(0);
  const last = useRef({ open: 0, list: 0 });
  useFrame(() => {
    const v = easeInOutCubic(clock.current.open);
    if (v !== last.current.open && (Math.abs(v - last.current.open) > 0.004 || v === 0 || v === 1)) {
      last.current.open = v;
      setOpenProgress(v);
    }
    const l = clock.current.list;
    if (l !== last.current.list && (Math.abs(l - last.current.list) > 0.004 || l === 0 || l === 1)) {
      last.current.list = l;
      setListProgress(l);
    }
  });
  const group = useRef<THREE.Group>(null);
  const hidden = phase === "shelves";
  useSceneMask(group, { visible: !hidden, interactive: phase === "closed", clip: null });
  const press = useCallback(() => {
    if (phase === "closed") onPress();
  }, [phase, onPress]);
  const listPress = useCallback(() => {
    if (phase === "closed") onListPress();
  }, [phase, onListPress]);
  const weekPress = useCallback(() => {
    if (phase === "closed") onWeekPress();
  }, [phase, onWeekPress]);
  return (
    <group ref={group}>
      <PantryExterior
        phase={phase}
        openProgress={openProgress}
        listPreview={listPreview}
        onPress={press}
        onListPress={listPress}
        listProgress={listProgress}
        weekPreview={weekPreview}
        onWeekPress={weekPress}
      />
    </group>
  );
}

/** Shelf column at SHELF_ORIGIN: clipped to the opening and not tappable until the camera is inside. */
function ShelvesMount({ phase, children }: { phase: PantryPhase; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const inside = phase === "shelves";
  useSceneMask(group, { visible: phase !== "closed", interactive: inside, clip: inside ? null : OPENING_CLIP });
  return (
    <group ref={group} position={SHELF_ORIGIN}>
      {children}
    </group>
  );
}

/**
 * Applies visibility, the interaction layer and clipping planes to every object/material under `ref`, every frame
 * (children mount asynchronously, e.g. items arriving from the server, so a one-off traversal would miss them).
 */
function useSceneMask(
  ref: MutableRefObject<THREE.Group | null>,
  opts: { visible: boolean; interactive: boolean; clip: THREE.Plane[] | null },
) {
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
  });
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    camera.layers.mask = LAYER_INTERACTIVE | LAYER_PASSIVE;
    g.visible = o.current.visible;
    if (!g.visible) {
      // Hidden objects are still raycast by three.js; move them off the interactive layer.
      g.traverse((obj) => (obj.layers.mask = LAYER_PASSIVE));
      return;
    }
    const mask = o.current.interactive ? LAYER_INTERACTIVE : LAYER_PASSIVE;
    const clip = o.current.clip;
    g.traverse((obj) => {
      obj.layers.mask = mask;
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        if (m.clippingPlanes !== clip) {
          m.clippingPlanes = clip;
          m.clipShadows = clip !== null; // also clip the shadow-map pass, or hidden shelves cast shadows on the wall
          m.needsUpdate = true;
        }
      }
    });
  });
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottomCenter: { position: "absolute", left: 0, right: 0, bottom: 20, alignItems: "center" },
  row: { flexDirection: "row", justifyContent: "center", gap: 10, flexWrap: "wrap", paddingHorizontal: 16 },
  quickRow: { marginBottom: 10 },
  promptCard: { left: 80, right: 80, padding: 0, backgroundColor: "transparent" },
  detailsPill: { backgroundColor: palette.oakDark, maxWidth: "80%" },
  detailsText: { color: palette.cream },
  topCenter: { position: "absolute", left: 0, right: 0, top: 56, alignItems: "center" },
  pill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: palette.cream,
    ...softShadow,
  },
  pressed: { opacity: 0.8 },
  pillText: { color: palette.oakInk },
  topCard: { position: "absolute", left: 20, right: 20, top: 56, borderRadius: 16, backgroundColor: palette.cream, padding: 16, ...softShadow },
  emptyCard: {
    position: "absolute",
    left: 32,
    right: 32,
    top: "38%",
    gap: 8,
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: palette.cream,
    padding: 18,
    ...softShadow,
  },
});
