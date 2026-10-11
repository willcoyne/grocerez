/**
 * Shopping-mode HUD (plain RN views over the canvas): top bar with Back, "Shopping · 3 of 8", a progress bar and the
 * list-view toggle; bottom bar with the cart count and Done; centred status cards (loading, error, empty).
 * Bright store palette; tap targets ≥ 44 pt; text scales with Dynamic Type (AppText caps at 1.3×).
 */
import { ChevronLeft, LayoutList, ScanBarcode, ShoppingCart, Store } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button } from "@/components/ui";
import { useThemeId } from "@/features/theme/ThemeProvider";
import { color } from "@/theme";

import { type OverlayPalette, shadowFor, useOverlayPalette } from "../../pantry/overlay/palette";

type HudColors = { card: string; ink: string; green: string; track: string; shadow: string; surface: string };

const COZY_HUD: HudColors = {
  card: "rgba(255,255,255,0.96)",
  ink: "#1C1B19",
  green: "#24563F",
  track: "#DDE5E1",
  shadow: "#1C2B24",
  surface: color.surface,
};

/** HUD colours: cozy keeps the bright store look; other themes use the theme's overlay palette (neon panels ~88% opaque). */
function hudColorsFor(P: OverlayPalette, cozy: boolean): HudColors {
  if (cozy) return COZY_HUD;
  return { card: P.panel, ink: P.ink, green: P.green, track: P.track, shadow: P.shadow, surface: P.panel };
}

/** Text style for custom content inside HUD cards (undefined on cozy). */
export function useHudInk() {
  return useHud().ink;
}

function useHud() {
  const P = useOverlayPalette();
  const cozy = useThemeId() === "cozy";
  return useMemo(() => {
    const H = hudColorsFor(P, cozy);
    const shadow = cozy
      ? ({ shadowColor: H.shadow, shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 } as const)
      : shadowFor(P);
    // themed panels are not white: AppText's default ink would vanish on the dark ones
    const ink = cozy ? undefined : { color: P.ink };
    const muted = cozy ? undefined : { color: P.muted };
    return { H, shadow, ink, muted, styles: makeStyles(P, H, shadow, cozy) };
  }, [P, cozy]);
}

function RoundIcon({ label, hint, onPress, children, testID }: { label: string; hint?: string; onPress: () => void; children: ReactNode; testID?: string }) {
  const { styles } = useHud();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

export function TopBar({
  done,
  total,
  listMode,
  onBack,
  onToggleList,
}: {
  done: number;
  total: number;
  listMode: boolean;
  onBack: () => void;
  onToggleList: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { H, shadow, ink, styles } = useHud();
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <View style={[styles.top, { paddingTop: insets.top + 10, paddingLeft: insets.left + 14, paddingRight: insets.right + 14 }]} pointerEvents="box-none">
      <RoundIcon testID="shopping-back" label="Leave shopping mode" hint="Checked items are added to your pantry" onPress={onBack}>
        <ChevronLeft size={26} color={H.ink} strokeWidth={2.6} />
      </RoundIcon>
      <View style={[styles.titleCard, shadow]}>
        <AppText variant="bodyL" weight="heavy" numberOfLines={1} testID="shopping-title" style={ink}>
          {`Shopping · ${done} of ${total}`}
        </AppText>
        <View
          style={styles.track}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Shopping progress"
          accessibilityValue={{ min: 0, max: Math.max(total, 1), now: done, text: `${done} of ${total} items in the cart` }}
          testID="shopping-progress"
        >
          <View style={[styles.fillBar, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>
      <RoundIcon
        testID="shopping-view-toggle"
        label={listMode ? "Show the store aisle" : "Show as a list"}
        hint={listMode ? undefined : "A simple checklist, best with a screen reader"}
        onPress={onToggleList}
      >
        {listMode ? <Store size={22} color={H.ink} /> : <LayoutList size={22} color={H.ink} />}
      </RoundIcon>
    </View>
  );
}

export function BottomBar({
  inCart,
  status,
  onDone,
  busy,
  onScanPress,
}: {
  inCart: number;
  status: string | null;
  onDone: () => void;
  busy: boolean;
  /** Integration slot: when set, a bottom-left "Scan" button opens the camera ScanSheet. */
  onScanPress?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { H, shadow, ink, muted, styles } = useHud();
  return (
    <View
      style={[styles.bottom, { paddingBottom: insets.bottom + 14, paddingLeft: insets.left + 14, paddingRight: insets.right + 14 }]}
      pointerEvents="box-none"
    >
      {onScanPress ? (
        <RoundIcon testID="shopping-scan" label="Scan a product" hint="Opens the camera to scan a barcode" onPress={onScanPress}>
          <ScanBarcode size={22} color={H.ink} />
        </RoundIcon>
      ) : null}
      <View
        style={[styles.cartPill, shadow]}
        accessible
        accessibilityLabel={`${inCart} ${inCart === 1 ? "item" : "items"} in the cart${status ? `. ${status}` : ""}`}
        testID="shopping-cart-count"
      >
        <ShoppingCart size={22} color={H.green} />
        <View style={styles.cartText}>
          <AppText variant="bodyS" weight="heavy" style={ink}>{`${inCart} in cart`}</AppText>
          {status ? (
            <AppText variant="micro" color="muted" uppercase={false} numberOfLines={1} style={muted}>
              {status}
            </AppText>
          ) : null}
        </View>
        {busy ? <ActivityIndicator size="small" color={H.green} /> : null}
      </View>
      <Button
        label="Done"
        onPress={onDone}
        accessibilityHint="Adds checked items to your pantry and leaves shopping mode"
        testID="shopping-done"
        style={styles.done}
      />
    </View>
  );
}

/** Centred card for loading / error / empty states. */
export function StatusCard({ children, testID }: { children: ReactNode; testID?: string }) {
  const { shadow, styles } = useHud();
  return (
    <View style={styles.center} pointerEvents="box-none">
      <View style={[styles.statusCard, shadow]} testID={testID}>
        {children}
      </View>
    </View>
  );
}

export function EmptyCard({ finished, onBack }: { finished: boolean; onBack: () => void }) {
  const { ink, muted } = useHud();
  return (
    <StatusCard testID="shopping-empty">
      <AppText variant="h1" center accessibilityRole="header" style={ink}>
        {finished ? "All done!" : "Nothing to buy"}
      </AppText>
      <AppText center color="ink2" style={muted}>
        {finished ? "Everything's in your pantry 🎉" : "Your shopping list is empty. Add items from the List tab."}
      </AppText>
      <Button label={finished ? "Back to the pantry" : "Go back"} onPress={onBack} testID="shopping-empty-back" />
    </StatusCard>
  );
}

const makeStyles = (P: OverlayPalette, H: HudColors, shadow: object, cozy: boolean) => {
  const frame = cozy ? {} : { borderWidth: P.frame, borderColor: P.border };
  return StyleSheet.create({
    top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "flex-start", gap: 10 },
    round: {
      width: 48,
      height: 48,
      borderRadius: P.r(24),
      backgroundColor: H.card,
      alignItems: "center",
      justifyContent: "center",
      ...shadow,
      ...frame,
    },
    pressed: { opacity: 0.75 },
    titleCard: { flex: 1, minHeight: 48, borderRadius: P.r(16), backgroundColor: H.card, paddingHorizontal: 14, paddingVertical: 8, gap: 6, ...frame },
    track: { height: 8, borderRadius: 4, backgroundColor: H.track, overflow: "hidden" },
    fillBar: { height: "100%", borderRadius: 4, backgroundColor: H.green },
    bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 10 },
    cartPill: {
      flexShrink: 1,
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      borderRadius: P.r(26),
      backgroundColor: H.card,
      ...frame,
    },
    cartText: { flexShrink: 1 },
    done: { marginLeft: "auto", minWidth: 110 },
    center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 28 },
    statusCard: { width: "100%", maxWidth: 360, gap: 12, alignItems: "center", borderRadius: P.r(20), backgroundColor: H.surface, padding: 22, ...frame },
  });
};
