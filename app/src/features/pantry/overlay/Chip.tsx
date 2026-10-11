import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { pressedOpacity, size } from "@/theme";

import { pantry } from "./palette";

/**
 * Toggle chip for the filter sheet. Selection is shown by fill + a check (or custom) icon + accessibilityState,
 * never by colour alone.
 */
export function FilterChip({
  label,
  accessibilityLabel,
  selected,
  onPress,
  selectedBg = pantry.oakDark,
  selectedFg = "#FFFFFF",
  idleBorder = "#D9C3A5",
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
        selected ? { backgroundColor: selectedBg, borderColor: selectedBg } : { borderColor: idleBorder },
        pressed && { opacity: pressedOpacity },
      ]}>
      {selected ? (icon ?? <Check size={16} color={selectedFg} strokeWidth={3} />) : null}
      <AppText variant="bodyS" weight="bold" style={{ color: selected ? selectedFg : pantry.ink }}>
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
    borderRadius: 22,
    borderWidth: 1.5,
    backgroundColor: pantry.cream,
  },
});
