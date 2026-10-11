import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { shadowFor, useOverlayPalette } from "./palette";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const ROUND_BUTTON_SIZE = 60;

/** Knob-style round button (cozy: oak ring, cream face), springy press. Colours / corners follow the theme. */
export function RoundButton({
  label,
  hint,
  onPress,
  children,
  style,
  size = ROUND_BUTTON_SIZE,
  testID,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  size?: number;
  testID?: string;
}) {
  const P = useOverlayPalette();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      onPressIn={() => {
        scale.set(withSpring(0.9, { damping: 15, stiffness: 400 }));
      }}
      onPressOut={() => {
        scale.set(withSpring(1, { damping: 9, stiffness: 260 }));
      }}
      hitSlop={6}
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: P.r(size / 2), backgroundColor: P.oak, borderColor: P.oakDark, borderWidth: P.bw(1) },
        shadowFor(P),
        style,
        animated,
      ]}>
      <View style={[styles.face, { borderRadius: P.r((size - 10) / 2), backgroundColor: P.face, borderColor: P.faceBorder, borderWidth: P.bw(1) }]}>
        {children}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    padding: 4,
  },
  face: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
