/**
 * Shopping mode (`/shopping`): you're in the store, walking down one long aisle of the group's shopping list.
 * Tap an item → it hops into the cart and its check-off is saved right away; checked items are moved into the pantry
 * in one batch after a short grace window (Undo meanwhile), when you tap Done, leave the screen or background the app.
 * A plain checklist (list toggle; default with a screen reader) does the same thing in 2D.
 * The bottom-left Scan button opens the camera ScanSheet (features/scan, `shopping` context): a scanned product checks
 * off its list row (saved by the sheet) and the item hops into the cart here, joining this trip's batch.
 *
 * Thin client: the list, allergen flags, aisle categories and the move-to-pantry transaction are all server data/calls.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { AppText, ErrorState, useToastBottomInset } from "@/components/ui";
import { ScanSheet } from "@/features/scan";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";

import { BottomBar, EmptyCard, StatusCard, TopBar, useHudInk } from "./hud/Hud";
import { Checklist } from "./hud/Checklist";
import type { StoreItem } from "./mapping";
import { buildAisleLayout, type AisleLayout } from "./scene/layout";
import { StoreCanvas } from "./scene/StoreCanvas";
import { StoreScene } from "./scene/StoreScene";
import { useAisleScroll } from "./scene/useAisleScroll";
import { useShoppingTrip } from "./useShoppingTrip";

export type ShoppingScreenProps = {
  /** Show the bottom-left "Scan" button + camera ScanSheet (default true). */
  scan?: boolean;
  /** Extra overlay, rendered above the HUD. */
  children?: ReactNode;
};

export function ShoppingScreen(props: ShoppingScreenProps) {
  const groupId = useRequiredGroupId();
  // Keyed by group: a household switch flushes the old group's batch with its own mutation and starts clean.
  return <ShoppingTripView key={groupId} groupId={groupId} {...props} />;
}

function ShoppingTripView({ groupId, scan = true, children }: ShoppingScreenProps & { groupId: string }) {
  const hudInk = useHudInk();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reducedMotion, screenReader } = useA11yPrefs();
  const [listPref, setListPref] = useState<boolean | null>(null);
  const listMode = listPref ?? screenReader;

  const scroll = useAisleScroll({ enabled: !listMode, reducedMotion });
  const layoutRef = useRef<AisleLayout | null>(null);
  const trip = useShoppingTrip(groupId, {
    reducedMotion,
    onUndo: (id) => {
      const slot = layoutRef.current?.slotById.get(id);
      if (slot) scroll.scrollTo(slot.x, { duration: 0.35 });
    },
  });
  const layout = useMemo(() => buildAisleLayout(trip.sections), [trip.sections]);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useToastBottomInset(insets.bottom + 84);

  const leave = useCallback(() => {
    // Unmounting flushes the batch (useShoppingTrip); the toast confirms from the app root.
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  const done = useCallback(() => {
    trip.finish();
    leave();
  }, [trip, leave]);

  const onItemPress = useCallback((it: StoreItem) => trip.checkOff(it.row), [trip]);
  const onCartItemPress = useCallback((it: StoreItem) => trip.undo(it.row.id), [trip]);
  const onToggle = useCallback((it: StoreItem) => trip.toggle(it.row), [trip]);

  const [scanOpen, setScanOpen] = useState(false);
  const openScan = useCallback(() => setScanOpen(true), []);
  const closeScan = useCallback(() => setScanOpen(false), []);
  const { addedElsewhere } = trip;
  const onAddedToCart = useCallback((listItemId: string) => addedElsewhere(listItemId), [addedElsewhere]);

  const { list } = trip;
  const scanContext = useMemo(() => ({ kind: "shopping" as const, groupId, list: list.data ?? [] }), [groupId, list.data]);
  const loading = list.isLoading;
  const failed = !!list.error && !list.data;
  const hopping = Object.keys(trip.flights).length > 0;
  const empty = !!list.data && trip.remaining === 0 && !hopping;

  const status = trip.saving
    ? "Saving…"
    : trip.completing
      ? "Adding to your pantry…"
      : trip.pending.length > 0
        ? "Adding to pantry soon"
        : trip.moved > 0
          ? `${trip.moved} added to your pantry`
          : null;

  return (
    <View style={styles.fill} testID="shopping-screen">
      {listMode ? (
        <Checklist sections={trip.sections} meId={trip.meId} onToggle={onToggle} />
      ) : (
        <GestureDetector gesture={scroll.gesture}>
          <View
            style={styles.fill}
            collapsable={false}
            accessible
            accessibilityLabel={`Store aisle with ${trip.remaining} ${trip.remaining === 1 ? "item" : "items"} left to pick up. Use the list view button for a checklist.`}
          >
            <StoreCanvas onWheel={scroll.onWheel} testID="shopping-canvas">
              <StoreScene
                layout={layout}
                cart={trip.cart}
                flights={trip.flights}
                scroll={scroll}
                onItemPress={onItemPress}
                onCartItemPress={onCartItemPress}
              />
            </StoreCanvas>
          </View>
        </GestureDetector>
      )}

      <TopBar
        done={trip.done}
        total={trip.total}
        listMode={listMode}
        onBack={leave}
        onToggleList={() => setListPref(!listMode)}
      />

      {loading ? (
        <StatusCard testID="shopping-loading">
          <ActivityIndicator accessibilityLabel="Loading your shopping list" />
          <AppText weight="bold" style={hudInk}>Loading your shopping list…</AppText>
        </StatusCard>
      ) : failed ? (
        <StatusCard testID="shopping-error">
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        </StatusCard>
      ) : empty ? (
        <EmptyCard finished={trip.done > 0} onBack={done} />
      ) : (
        <BottomBar
          inCart={trip.cart.length}
          status={status}
          busy={trip.saving || trip.completing}
          onDone={done}
          onScanPress={scan ? openScan : undefined}
        />
      )}

      {!loading && !failed && !empty && !listMode && trip.done === 0 ? (
        <View style={[styles.hint, { top: insets.top + 76 }]} pointerEvents="none">
          <AppText variant="caption" weight="bold" style={styles.hintText}>
            Tap an item to put it in your cart · drag to walk the aisle
          </AppText>
        </View>
      ) : null}
      {scan ? (
        <ScanSheet
          visible={scanOpen}
          onClose={closeScan}
          context={scanContext}
          onAddedToCart={onAddedToCart}
        />
      ) : null}
      {children}
    </View>
  );
}

function useA11yPrefs() {
  const [reducedMotion, setReduced] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(v))
      .catch(() => {});
    // react-native-web always reports a screen reader, so only native switches to the checklist automatically.
    if (Platform.OS !== "web") {
      AccessibilityInfo.isScreenReaderEnabled()
        .then((v) => alive && setScreenReader(v))
        .catch(() => {});
    }
    const a = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const b = AccessibilityInfo.addEventListener("screenReaderChanged", (v) => Platform.OS !== "web" && setScreenReader(v));
    return () => {
      alive = false;
      a.remove();
      b.remove();
    };
  }, []);
  return { reducedMotion, screenReader };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  hintText: {
    color: "#FFFFFF",
    backgroundColor: "rgba(28,27,25,0.72)",
    overflow: "hidden",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
