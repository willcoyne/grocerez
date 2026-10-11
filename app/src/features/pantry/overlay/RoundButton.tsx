import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { pantry, softShadow } from "./palette";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const ROUND_BUTTON_SIZE = 60;

/** Wooden knob-style round button: oak ring, cream face, springy press. */
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
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, softShadow, style, animated]}>
      <View style={[styles.face, { borderRadius: (size - 10) / 2 }]}>{children}</View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    backgroundColor: pantry.oak,
    borderWidth: 1,
    borderColor: pantry.oakDark,
    padding: 4,
  },
  face: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: pantry.cream,
    borderWidth: 1,
    borderColor: "#E3C9A8",
  },
});
