import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { pressedOpacity, size } from "@/theme";

import { useOverlayPalette } from "./palette";

/**
 * Toggle chip for the filter sheet. Selection is shown by fill + a check (or custom) icon + accessibilityState,
 * never by colour alone.
 */
export function FilterChip({
  label,
  accessibilityLabel,
  selected,
  onPress,
  selectedBg,
  selectedFg,
  idleBorder,
  icon,
  accessory,
  testID,
}: {
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
  selectedBg?: string;
  selectedFg?: string;
  idleBorder?: string;
  /** Replaces the default check icon when selected. */
  icon?: ReactNode;
  /** Extra element after the label (e.g. a "You" tag). */
  accessory?: ReactNode;
  testID?: string;
}) {
  const P = useOverlayPalette();
  const bg = selectedBg ?? P.oakDark;
  const fg = selectedFg ?? P.onAccent;
  const border = idleBorder ?? P.idleBorder;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: P.cream, borderRadius: P.r(22), borderWidth: P.bw(1.5) },
        selected ? { backgroundColor: bg, borderColor: bg } : { borderColor: border },
        pressed && { opacity: pressedOpacity },
      ]}>
      {selected ? (icon ?? <Check size={16} color={fg} strokeWidth={3} />) : null}
      <AppText variant="bodyS" weight="bold" style={{ color: selected ? fg : P.ink }}>
        {label}
      </AppText>
      {accessory ? <View>{accessory}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: size.hit,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
  },
});
