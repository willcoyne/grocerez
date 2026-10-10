import { StyleSheet, Text, type TextProps } from 'react-native';

import { color, font, letterSpacing, maxFontScale, typeScale, type ColorName, type TypeVariant } from '@/theme';

export type Weight = 'medium' | 'semi' | 'bold' | 'heavy' | 'display';

const fontFor: Record<Weight, string> = {
  medium: font.bodyMedium,
  semi: font.bodySemi,
  bold: font.bodyBold,
  heavy: font.bodyHeavy,
  display: font.display,
};

const defaultWeight: Record<TypeVariant, Weight> = {
  hero: 'display',
  h1: 'display',
  tabTitle: 'display',
  lead: 'medium',
  bodyL: 'medium',
  body: 'medium',
  bodyS: 'medium',
  caption: 'medium',
  micro: 'bold',
};

export type AppTextProps = TextProps & {
  /** Type scale entry from theme (DESIGN.md §2). Default `body`. */
  variant?: TypeVariant;
  weight?: Weight;
  color?: ColorName;
  /** micro labels are uppercase in the spec; set explicitly where needed. */
  uppercase?: boolean;
  strike?: boolean;
  center?: boolean;
};

/** All app text. Caps Dynamic Type at 1.3× (DESIGN.md §7). */
export function AppText({
  variant = 'body',
  weight,
  color: colorName = 'ink',
  uppercase,
  strike,
  center,
  style,
  ...rest
}: AppTextProps) {
  const [fontSize, lineHeight] = typeScale[variant];
  return (
    <Text
      maxFontSizeMultiplier={maxFontScale}
      style={[
        {
          fontFamily: fontFor[weight ?? defaultWeight[variant]],
          fontSize,
          lineHeight,
          letterSpacing: letterSpacing[variant],
          color: color[colorName],
        },
        uppercase && styles.upper,
        strike && styles.strike,
        center && styles.center,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  upper: { textTransform: 'uppercase' },
  strike: { textDecorationLine: 'line-through' },
  center: { textAlign: 'center' },
});
