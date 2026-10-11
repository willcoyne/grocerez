/**
 * Switching between the two interfaces (state/uiPrefs.tsx): the fun 3D pantry room and the simple screens (no 3D, no
 * animation). Both are saved to the user's account, as is the room's theme.
 */
import { Box, LayoutList } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText, IconButton } from "@/components/ui";
import { useSetUiMode, useUiMode } from "@/state/uiPrefs";
import { color, radius, space } from "@/theme";

const CHOICES = [
  { mode: "room", label: "3D room", hint: "The pantry as an animated 3D room", Icon: Box },
  { mode: "simple", label: "Simple", hint: "Plain screens, no 3D or animation", Icon: LayoutList },
] as const;

/** Two-way choice for the Me screens. */
export function InterfaceChoice() {
  const mode = useUiMode();
  const setMode = useSetUiMode();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" testID="interface-choice">
      {CHOICES.map(({ mode: m, label, hint, Icon }) => {
        const on = mode === m;
        return (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={label}
            accessibilityHint={hint}
            onPress={() => setMode(m)}
            style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && styles.pressed]}
            testID={`interface-${m}`}
          >
            <Icon size={20} color={on ? color.primary : color.ink2} />
            <AppText weight="bold" color={on ? "primary" : "ink2"}>
              {label}
            </AppText>
            <AppText variant="caption" color="muted" center>
              {hint}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Header button on the simple screens: back to the 3D room. */
export function RoomModeButton() {
  const setMode = useSetUiMode();
  return (
    <IconButton label="Switch to the 3D room" onPress={() => setMode("room")} testID="switch-to-room">
      <Box size={20} color={color.ink2} />
    </IconButton>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  choice: {
    flex: 1,
    alignItems: "center",
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  choiceOn: { borderColor: color.primary },
  pressed: { opacity: 0.8 },
});
