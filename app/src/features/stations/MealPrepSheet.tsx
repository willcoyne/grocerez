/**
 * Meal-prep calendar station (SPEC.md round 3 addendum). The planner is a later feature: this sheet shows a
 * "coming soon" placeholder with the empty week grid (Mon–Sun × Breakfast / Lunch / Dinner) the real planner will fill.
 *
 * When the planner lands, replace <WeekGridPlaceholder/> with the real grid (same shape: days as columns, meals as rows).
 */
import { CalendarDays } from "lucide-react-native";
import { ScrollView, StyleSheet, View } from "react-native";

import { sheetTokens, withAlpha } from "./colors";
import { HeaderIcon, SoonTag, StationSection, ThemedText } from "./parts";
import { StationSheet } from "./StationSheet";
import { useThemeUi } from "./theme";

export type MealPrepSheetProps = { visible: boolean; onClose: () => void };

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MEALS = ["Breakfast", "Lunch", "Dinner"] as const;

export function MealPrepSheet({ visible, onClose }: MealPrepSheetProps) {
  return (
    <StationSheet
      visible={visible}
      onClose={onClose}
      title="Meal prep"
      subtitle="Meal prep calendar — coming soon"
      headerLeft={<HeaderIcon icon={CalendarDays} />}
      testID="mealprep-sheet"
    >
      <ThemedText>
        Soon you&apos;ll plan the week&apos;s meals here, and their ingredients will go straight onto the shopping list.
      </ThemedText>
      <StationSection title="This week" bare>
        <View style={styles.soonRow}>
          <SoonTag label="Coming soon" />
        </View>
        <WeekGridPlaceholder />
      </StationSection>
    </StationSheet>
  );
}

/** Empty week grid; scrolls sideways on narrow screens / large text. Not interactive yet. */
function WeekGridPlaceholder() {
  const ui = useThemeUi();
  const t = sheetTokens(ui);
  const line = withAlpha(ui.panelBorder, 0.5);
  const cellRadius = t.pixel ? 0 : 6;
  return (
    <View
      accessible
      accessibilityLabel="Meal prep calendar, coming soon. An empty week from Monday to Sunday with breakfast, lunch and dinner."
      accessibilityState={{ disabled: true }}
      testID="mealprep-week-grid"
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gridScroll}>
        <View style={styles.grid}>
          <View style={styles.row}>
            <View style={styles.rowLabel} />
            {WEEK_DAYS.map((d) => (
              <View key={d} style={styles.cell}>
                <ThemedText variant="micro" weight="heavy" center>
                  {d}
                </ThemedText>
              </View>
            ))}
          </View>
          {MEALS.map((meal) => (
            <View key={meal} style={styles.row}>
              <View style={styles.rowLabel}>
                <ThemedText variant="caption" weight="bold" muted numberOfLines={1}>
                  {meal}
                </ThemedText>
              </View>
              {WEEK_DAYS.map((d) => (
                <View
                  key={d}
                  testID={`mealprep-cell-${d}-${meal}`}
                  style={[
                    styles.cell,
                    styles.slot,
                    {
                      borderColor: line,
                      borderRadius: cellRadius,
                      backgroundColor: withAlpha(ui.buttonFace, 0.55),
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const CELL = 40;

const styles = StyleSheet.create({
  soonRow: { flexDirection: "row" },
  gridScroll: { flexGrow: 1 },
  grid: { flexGrow: 1, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowLabel: { width: 78, justifyContent: "center" },
  cell: { flexGrow: 1, minWidth: CELL, alignItems: "center", justifyContent: "center" },
  slot: { height: CELL, borderWidth: 1.5, borderStyle: "dashed" },
});
