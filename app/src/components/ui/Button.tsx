import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { color, pressedOpacity, radius, size, type ColorName } from '@/theme';

import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger-secondary';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** flex: 1 inside a row of buttons. */
  flex?: boolean;
  disabled?: boolean;
  /** Shows a spinner and blocks presses (a request is in flight). */
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

const variants: Record<ButtonVariant, { bg: string; border?: string; fg: ColorName }> = {
  primary: { bg: color.primary, fg: 'onPrimary' },
  secondary: { bg: color.surface, border: color.borderStrong, fg: 'ink' },
  dark: { bg: color.ink, fg: 'onPrimary' },
  ghost: { bg: 'transparent', fg: 'primary' },
  'danger-secondary': { bg: color.surface, border: color.borderStrong, fg: 'dangerFg' },
};

const heights: Record<ButtonSize, number> = { sm: size.btnSm, md: size.btn, lg: size.btnLg };
const textVariant = { sm: 'bodyS', md: 'body', lg: 'bodyL' } as const;

/** DESIGN.md §3 Button. Text is Manrope bold; pressed opacity .85. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size: s = 'md',
  fullWidth,
  flex,
  disabled,
  loading,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const v = variants[variant];
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
        styles.base,
        {
          minHeight: heights[s],
          borderRadius: s === 'lg' ? radius.card : radius.control,
          paddingHorizontal: s === 'sm' ? 14 : 18,
          backgroundColor: disabled ? color.disabledBg : v.bg,
          borderWidth: v.border && !disabled ? 1 : 0,
          borderColor: v.border,
        },
        fullWidth && styles.full,
        flex && styles.flex,
        pressed && !inactive && { opacity: pressedOpacity },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={color[v.fg]} />
      ) : (
        <AppText variant={textVariant[s]} weight="bold" color={disabled ? 'disabledFg' : v.fg} center>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  full: { alignSelf: 'stretch' },
  flex: { flex: 1 },
});
