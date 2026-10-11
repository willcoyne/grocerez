/**
 * Theme picker (SPEC.md round 3 "Appearance"): one card per theme, each drawn in that theme's own overlay colours with
 * a mini pantry, its name, description and swatches. A radio group: exactly one card is checked; tapping a card switches
 * (and persists) the theme through the theme system. The selected card says "Selected" with a check mark, so the state
 * never relies on colour alone.
 */
import { Check } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import type { ThemeId } from "@/features/theme/types";
import { pressedOpacity, space } from "@/theme";

import { sheetTokens } from "./colors";
import { PantryMiniature } from "./PantryMiniature";
import { type ThemeChoice, useActiveThemeId, useSetTheme, useThemeChoices, useThemeUi } from "./theme";

export type AppearancePickerProps = {
  /** Called after the theme was switched (e.g. to announce or close a sheet). */
  onSelect?: (id: ThemeId) => void;
  testID?: string;
};

export function AppearancePicker({ onSelect, testID = "appearance-picker" }: AppearancePickerProps) {
  const themes = useThemeChoices();
  const activeId = useActiveThemeId();
  const setTheme = useSetTheme();
  const ui = useThemeUi();

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={styles.grid} testID={testID}>
      {themes.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={theme.id === activeId}
          ringColor={ui.accent}
          onPress={() => {
            if (theme.id !== activeId) setTheme(theme.id);
            onSelect?.(theme.id);
          }}
        />
      ))}
    </View>
  );
}

function ThemeCard({
  theme,
  selected,
  ringColor,
  onPress,
}: {
  theme: ThemeChoice;
  selected: boolean;
  /** Selection ring in the ACTIVE theme's accent, so it shows on every card. */
  ringColor: string;
  onPress: () => void;
}) {
  const own = sheetTokens(theme.ui);
  const font = own.fontFamily ? { fontFamily: own.fontFamily } : null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${theme.name} theme. ${theme.description}`}
      accessibilityHint={selected ? undefined : "Changes the look of your pantry"}
      onPress={onPress}
      testID={`theme-card-${theme.id}`}
      style={({ pressed }) => [
        styles.ring,
        { borderColor: selected ? ringColor : "transparent", borderRadius: own.pixel ? 0 : own.cardRadius + 4 },
        pressed && { opacity: pressedOpacity },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.ui.panel,
            borderColor: theme.ui.panelBorder,
            borderWidth: Math.max(1, own.border),
            borderRadius: own.cardRadius,
          },
          own.pixel && { borderBottomWidth: own.border + 3 },
        ]}
      >
        <PantryMiniature theme={theme} />
        <View style={styles.nameRow}>
          <AppText variant="bodyL" weight="heavy" style={[{ color: theme.ui.text }, font, styles.flex]}>
            {theme.name}
          </AppText>
          {selected ? (
            <View
              style={[styles.selected, { backgroundColor: theme.ui.accent, borderRadius: own.pixel ? 0 : 12 }]}
              testID={`theme-selected-${theme.id}`}
            >
              <Check size={14} color={own.onAccent} strokeWidth={3.2} />
              <AppText variant="micro" weight="heavy" style={{ color: own.onAccent }}>
                Selected
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" style={{ color: theme.ui.textMuted }}>
          {theme.description}
        </AppText>
        <View style={styles.swatches} accessible={false} importantForAccessibility="no-hide-descendants">
          {theme.swatches.slice(0, 5).map((c, i) => (
            <View
              key={`${c}-${i}`}
              style={[styles.swatch, { backgroundColor: c, borderColor: theme.ui.panelBorder, borderRadius: own.pixel ? 0 : 7 }]}
            />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  ring: { flexGrow: 1, flexBasis: 150, borderWidth: 3, padding: 2 },
  card: { flex: 1, padding: space.sm, gap: 6, overflow: "hidden" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  flex: { flexShrink: 1 },
  selected: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2 },
  swatches: { flexDirection: "row", gap: 5, marginTop: 2 },
  swatch: { width: 18, height: 18, borderWidth: 1 },
});
