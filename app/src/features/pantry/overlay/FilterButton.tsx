import { SlidersHorizontal } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";

import { useOverlayPalette } from "./palette";
import { RoundButton } from "./RoundButton";
import { useOverlayInsets } from "./useOverlayInsets";

/** Floating filter knob, bottom-right, with a count badge when filters are on. */
export function FilterButton({
  onPress,
  activeCount,
  bottomOffset,
}: {
  onPress: () => void;
  activeCount: number;
  bottomOffset?: number;
}) {
  const P = useOverlayPalette();
  const inset = useOverlayInsets(bottomOffset);
  const label = activeCount > 0 ? `Filters, ${activeCount} active` : "Filters";
  return (
    <View style={[styles.pos, { right: inset.right, bottom: inset.bottom }]} pointerEvents="box-none">
      <RoundButton testID="pantry-filter-button" label={label} hint="Filter what shows on the shelves" onPress={onPress}>
        <SlidersHorizontal size={26} color={P.oakDark} strokeWidth={2.5} />
      </RoundButton>
      {activeCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: P.green, borderColor: P.cream, borderRadius: P.r(12) }]} pointerEvents="none" testID="pantry-filter-badge" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <AppText variant="micro" weight="heavy" style={[styles.badgeText, { color: P.onAccent }]}>
            {activeCount > 9 ? "9+" : String(activeCount)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pos: { position: "absolute" },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { letterSpacing: 0 },
});
