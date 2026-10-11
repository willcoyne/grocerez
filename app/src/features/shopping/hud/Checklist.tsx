/**
 * 2D fallback for shopping mode (screen readers, reduced motion, or preference): a plain checklist grouped by aisle,
 * with the same check / undo / batched-complete behaviour as the 3D aisle. Allergen flags name member + allergen.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Checkbox, StatusChip } from "@/components/ui";
import { useThemeId } from "@/features/theme/ThemeProvider";
import { color } from "@/theme";

import { type OverlayPalette, useOverlayPalette, useOverlayStyles } from "../../pantry/overlay/palette";

import { allergenSummary, type StoreItem, type StoreSection } from "../mapping";

export function Checklist({
  sections,
  meId,
  onToggle,
}: {
  sections: StoreSection[];
  meId: string | null;
  onToggle: (item: StoreItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useOverlayStyles(makeStyles);
  const P = useOverlayPalette();
  // cozy keeps the app's own text colours; themed lists take the theme ink
  const ink = useThemeId() === "cozy" ? undefined : { color: P.ink };
  const muted = useThemeId() === "cozy" ? undefined : { color: P.muted };
  return (
    <ScrollView
      testID="shopping-checklist"
      style={styles.fill}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 86, paddingBottom: insets.bottom + 110 }]}
    >
      {sections.map((s) => (
        <View key={s.aisle} style={styles.section}>
          <AppText variant="micro" color="muted" accessibilityRole="header" style={muted}>
            {s.label}
          </AppText>
          {s.items.map((it) => {
            const { row } = it;
            const summary = allergenSummary(row.allergenFlags, meId);
            return (
              <View key={row.id} style={[styles.row, row.checked && styles.rowDone]} testID={`shopping-row-${row.id}`}>
                <Checkbox checked={row.checked} name={row.item.name} onPress={() => onToggle(it)} testID={`shopping-check-${row.id}`} />
                <View style={styles.body}>
                  <AppText variant="bodyL" weight="heavy" strike={row.checked} color={row.checked ? "muted" : "ink"} style={row.checked ? muted : ink}>
                    {row.item.name}
                  </AppText>
                  {row.quantityText || row.checked ? (
                    <AppText variant="caption" color="muted" style={muted}>
                      {[row.quantityText, row.checked ? "In the cart" : null].filter(Boolean).join(" · ")}
                    </AppText>
                  ) : null}
                  {row.allergenFlags.length > 0 ? (
                    <View style={styles.chips} accessible accessibilityLabel={summary}>
                      {row.allergenFlags.map((f) => (
                        <StatusChip
                          key={`${f.userId}-${f.allergen}`}
                          tone="danger"
                          label={`! Contains ${f.allergen.replace(/_/g, " ")} · ${f.userId === meId ? "you" : f.displayName}`}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (P: OverlayPalette) => {
  const cozy = P.panel === "#FFF8EE";
    return StyleSheet.create({
    fill: { flex: 1, backgroundColor: cozy ? color.bg : P.wall },
    content: { paddingHorizontal: 16, gap: 18 },
    section: { gap: 8 },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      padding: 12,
      borderRadius: cozy ? 14 : P.r(14),
      backgroundColor: cozy ? color.surface : P.panel,
      borderWidth: 1,
      borderColor: cozy ? color.border : P.border,
    },
    rowDone: { backgroundColor: cozy ? color.surfaceMuted : P.panelAlt },
    body: { flex: 1, gap: 2 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  });
};
