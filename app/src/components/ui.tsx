import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { colors, fontSize, radius, spacing, TAP_TARGET } from "@/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
  compact?: boolean;
}

export function Button({ title, variant = "primary", loading, disabled, icon, style, compact, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;
  const v = variantStyles[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        v.container,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={v.text.color} /> : icon}
      <Text style={[styles.buttonText, v.text]}>{title}</Text>
    </Pressable>
  );
}

const variantStyles: Record<Variant, { container: ViewStyle; text: TextStyle }> = {
  primary: { container: { backgroundColor: colors.primary }, text: { color: colors.onPrimary } },
  secondary: {
    container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
    text: { color: colors.primary },
  },
  danger: { container: { backgroundColor: colors.danger }, text: { color: colors.onPrimary } },
  ghost: { container: { backgroundColor: "transparent" }, text: { color: colors.primary } },
};

/** A pressable icon/text with an accessibility label and a 44pt tap target. */
export function IconButton({
  label,
  children,
  onPress,
  disabled,
  style,
  testID,
}: {
  label: string;
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      {children}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  tone = "neutral",
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: "neutral" | "danger" | "warning" | "success" | "ai";
  accessibilityLabel?: string;
}) {
  const toneStyle = chipTones[tone];
  const content = (
    <Text style={[styles.chipText, toneStyle.text, selected && styles.chipTextSelected]} maxFontSizeMultiplier={1.6}>
      {selected ? "✓ " : ""}
      {label}
    </Text>
  );
  if (!onPress) {
    return (
      <View style={[styles.chip, toneStyle.container]} accessibilityLabel={accessibilityLabel ?? label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        styles.chipPressable,
        toneStyle.container,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

const chipTones = {
  neutral: { container: { backgroundColor: colors.surface, borderColor: colors.border }, text: { color: colors.text } },
  danger: { container: { backgroundColor: colors.dangerLight, borderColor: colors.danger }, text: { color: colors.danger } },
  warning: { container: { backgroundColor: colors.warningLight, borderColor: colors.warning }, text: { color: colors.warning } },
  success: { container: { backgroundColor: colors.successLight, borderColor: colors.success }, text: { color: colors.success } },
  ai: { container: { backgroundColor: colors.aiLight, borderColor: colors.ai }, text: { color: colors.ai } },
} satisfies Record<string, { container: ViewStyle; text: TextStyle }>;

export function Input(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Marks AI-generated content (the board's deterministic vs. agentic split). */
export function AiLabel({ text = "AI suggestion" }: { text?: string }) {
  return (
    <View style={styles.aiLabel} accessibilityLabel={`${text}, generated by AI`}>
      <Text style={styles.aiLabelText}>✨ {text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: TAP_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  buttonCompact: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  buttonText: { fontSize: fontSize.md, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  iconButton: { minWidth: TAP_TARGET, minHeight: TAP_TARGET, alignItems: "center", justifyContent: "center" },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: "flex-start",
  },
  chipPressable: { minHeight: TAP_TARGET, justifyContent: "center" },
  chipSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm },
  chipTextSelected: { color: colors.primaryDark, fontWeight: "600" },
  label: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "600" },
  input: {
    minHeight: TAP_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  aiLabel: {
    alignSelf: "flex-start",
    backgroundColor: colors.aiLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  aiLabelText: { color: colors.ai, fontSize: fontSize.xs, fontWeight: "700" },
});
