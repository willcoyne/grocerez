/** Small themed building blocks shared by the station sheets. All colours come from the active theme's `ThemeUi`. */
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppText, type AppTextProps } from "@/components/ui";
import { pressedOpacity, size, space } from "@/theme";

import { sheetTokens, withAlpha } from "./colors";
import { useThemeUi } from "./theme";

/** AppText in the theme's text colour and (when set) the theme's font. Keeps AppText's 1.3× Dynamic Type cap. */
export function ThemedText({ muted, style, ...rest }: AppTextProps & { muted?: boolean }) {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  return <AppText {...rest} style={[{ color: muted ? ui.textMuted : ui.text }, t.fontFamily ? { fontFamily: t.fontFamily } : null, style]} />;
}

/**
 * A titled block inside a sheet. The title sits on the themed panel; `children` sit on a light content card, because
 * the reused app components are drawn with the app's light tokens. `bare` drops the card (for themed content).
 */
export function StationSection({
  title,
  subtitle,
  bare,
  children,
  testID,
}: {
  title?: string;
  subtitle?: string;
  bare?: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  return (
    <View style={styles.section} testID={testID}>
      {title ? (
        <View style={styles.sectionHead}>
          <ThemedText variant="micro" weight="heavy" accessibilityRole="header" style={styles.sectionTitle}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText variant="caption" muted>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      {bare ? (
        children
      ) : (
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.contentSurface,
              borderColor: t.contentBorder,
              borderWidth: Math.max(1, t.pixel ? t.border : ui.borderWidth),
              borderRadius: t.cardRadius,
            },
            t.pixel && { borderBottomWidth: t.border + 2 },
          ]}
        >
          {children}
        </View>
      )}
    </View>
  );
}

export type ThemedButtonVariant = "primary" | "secondary";

/** Theme-styled button: accent face for primary, button face + ring for secondary. ≥ 48 high. */
export function ThemedButton({
  label,
  onPress,
  variant = "primary",
  icon: Icon,
  disabled,
  loading,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ThemedButtonVariant;
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  const primary = variant === "primary";
  const fg = primary ? t.onAccent : ui.text;
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderRadius: t.buttonRadius,
          backgroundColor: primary ? ui.accent : ui.buttonFace,
          borderColor: primary ? ui.accent : ui.buttonRing,
          borderWidth: Math.max(1, t.border),
        },
        t.pixel && { borderBottomWidth: t.border + 3, borderColor: ui.panelBorder },
        disabled && styles.disabled,
        pressed && !inactive && { opacity: pressedOpacity },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {Icon ? <Icon size={20} color={fg} strokeWidth={2.4} /> : null}
          <ThemedText variant="body" weight="bold" style={[styles.buttonText, { color: fg }]}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

/** Round (or square, for pixel UI) icon badge used at the left of a sheet header. Decorative. */
export function HeaderIcon({ icon: Icon }: { icon: LucideIcon }) {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.headerIcon,
        {
          backgroundColor: ui.buttonFace,
          borderColor: ui.buttonRing,
          borderWidth: Math.max(2, t.border),
          borderRadius: t.pixel ? 0 : 24,
        },
      ]}
    >
      <Icon size={24} color={ui.buttonIcon} strokeWidth={2.2} />
    </View>
  );
}

/** "Soon" tag for placeholder features (text, so it never relies on colour alone). */
export function SoonTag({ label = "Soon" }: { label?: string }) {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  return (
    <View style={[styles.soon, { borderColor: ui.panelBorder, backgroundColor: withAlpha(ui.accent, 0.12), borderRadius: t.pixel ? 0 : 10 }]}>
      <ThemedText variant="micro" weight="heavy">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  sectionHead: { gap: 2, paddingHorizontal: 2 },
  sectionTitle: { letterSpacing: 1.2 },
  card: { padding: space.md, gap: space.md },
  button: {
    minHeight: size.btn,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonText: { textAlign: "center", flexShrink: 1 },
  disabled: { opacity: 0.5 },
  headerIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  soon: { alignSelf: "flex-start", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
});
