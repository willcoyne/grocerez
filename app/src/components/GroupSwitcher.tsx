import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useActiveGroup } from "@/state/ActiveGroupContext";
import { colors, fontSize, radius, spacing, TAP_TARGET } from "@/theme";

/** Header title: the active household, with a dropdown to switch when the user is in several. */
export function GroupSwitcher() {
  const { activeGroup, groups, setActiveGroupId } = useActiveGroup();
  const [open, setOpen] = useState(false);
  const several = groups.length > 1;

  return (
    <>
      <Pressable
        accessibilityRole={several ? "button" : "header"}
        accessibilityLabel={several ? `Household ${activeGroup?.name}. Switch household` : activeGroup?.name}
        disabled={!several}
        onPress={() => setOpen(true)}
        style={styles.title}
      >
        <Text style={styles.titleText} numberOfLines={1}>
          {activeGroup?.name ?? "GrocerEZ"}
          {several ? " ▾" : ""}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close household list">
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Switch household</Text>
            {groups.map((g) => (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                accessibilityState={{ selected: g.id === activeGroup?.id }}
                style={styles.option}
                onPress={() => {
                  setActiveGroupId(g.id);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, g.id === activeGroup?.id && styles.selected]}>
                  {g.id === activeGroup?.id ? "✓ " : ""}
                  {g.name}
                </Text>
                <Text style={styles.muted}>
                  {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  title: { minHeight: TAP_TARGET, justifyContent: "center", maxWidth: 260 },
  titleText: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-start", paddingTop: 100, padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  sheetTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.textMuted, marginBottom: spacing.sm },
  option: { minHeight: TAP_TARGET, justifyContent: "center", paddingVertical: spacing.sm },
  optionText: { fontSize: fontSize.md, color: colors.text },
  selected: { fontWeight: "700", color: colors.primary },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
});
