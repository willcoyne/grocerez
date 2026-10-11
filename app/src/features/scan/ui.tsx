/** Theme-styled buttons for the scan overlay (the app kit's Button is fixed to the app palette). */
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "@/components/ui";
import { contrastRatio, isHexColor } from "@/features/theme/color";

import { useThemeUi } from "./scanTheme";

/** White or near-black, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  if (!isHexColor(bg)) return "#FFFFFF";
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#111111") ? "#FFFFFF" : "#111111";
}

export type ScanButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function ScanButton({ label, onPress, variant = "primary", loading, disabled, accessibilityHint, testID, style }: ScanButtonProps) {
  const ui = useThemeUi();
  const inactive = !!(loading || disabled);
  const bg = variant === "primary" ? ui.accent : variant === "secondary" ? ui.buttonFace : "transparent";
  const fg = variant === "primary" ? readableOn(ui.accent) : variant === "secondary" ? ui.text : ui.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderRadius: Math.min(ui.radius, 16),
          borderColor: variant === "secondary" ? ui.buttonRing : "transparent",
          borderWidth: variant === "secondary" ? Math.max(1, Math.min(ui.borderWidth, 2)) : 0,
        },
        disabled && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <AppText variant="body" weight="bold" style={{ color: fg }} center>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
