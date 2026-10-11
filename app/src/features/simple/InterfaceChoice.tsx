/**
 * Switching between the two interfaces (state/uiPrefs.tsx): the fun 3D pantry room and the simple screens (no 3D, no
 * animation), plus the room's animation speed. All saved to the user's account, as is the room's theme.
 */
import { Box, Gauge, LayoutList, Zap } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText, IconButton } from "@/components/ui";
import { useMotion, useSetMotion, useSetUiMode, useUiMode } from "@/state/uiPrefs";
import { color, radius, space } from "@/theme";

const CHOICES = [
  { mode: "room", label: "3D room", hint: "The pantry as an animated 3D room", Icon: Box },
  { mode: "simple", label: "Simple", hint: "Plain screens, no 3D or animation", Icon: LayoutList },
] as const;

const SPEEDS = [
  { mode: "normal", label: "Normal", hint: "Doors swing, the camera glides, papers lift", Icon: Gauge },
  { mode: "fast", label: "Fast", hint: "No animations: cuts straight to each view", Icon: Zap },
] as const;

/** Two-way choice for the Me screens: 3D room or simple screens. */
export function InterfaceChoice() {
  return <Choice choices={CHOICES} value={useUiMode()} onChange={useSetUiMode()} testID="interface" />;
}

/** Two-way choice for the Me screens: normal or fast 3D animations. */
export function AnimationChoice() {
  return <Choice choices={SPEEDS} value={useMotion()} onChange={useSetMotion()} testID="motion" />;
}

function Choice<M extends string>({
  choices,
  value,
  onChange,
  testID,
}: {
  choices: readonly { mode: M; label: string; hint: string; Icon: typeof Box }[];
  value: M;
  onChange: (m: M) => void;
  testID: string;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" testID={`${testID}-choice`}>
      {choices.map(({ mode: m, label, hint, Icon }) => {
        const on = value === m;
        return (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={label}
            accessibilityHint={hint}
            onPress={() => onChange(m)}
            style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && styles.pressed]}
            testID={`${testID}-${m}`}
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
