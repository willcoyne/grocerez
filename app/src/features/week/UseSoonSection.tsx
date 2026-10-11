import type { MealPlanResponse } from "@contracts/mealPlan";
import { Check, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { NOTE_PAPER, PAPER_MARGIN_X, PaperSection, paperStyles } from "@/features/pantry/overlay/PaperSheet";
import { pantry } from "@/features/pantry/overlay/palette";

import { dayLabels, daysLeftText } from "./weekDates";

type Expiring = MealPlanResponse["expiring"][number];

/** "USE SOON": cabinet items expiring within a week, and whether a planned dinner uses each (spec §14). Server decides all of it. */
export function UseSoonSection({ items, canPlan, onPlan }: { items: readonly Expiring[]; canPlan: boolean; onPlan: () => void }) {
  if (!items.length) return null;
  const needsPlan = items.some((e) => e.daysLeft >= 0 && !e.plannedOn);
  return (
    <View testID="week-use-soon">
      <PaperSection title="USE SOON" />
      {items.map((e) => {
        const expired = e.daysLeft < 0;
        const planned = !expired && !!e.plannedOn;
        const status = expired ? "expired" : e.plannedOn ? dayLabels(e.plannedOn).short : "not planned";
        const label = expired
          ? `${e.name}, expired`
          : `${e.name}, ${daysLeftText(e.daysLeft)}, ${e.plannedOn ? `planned ${dayLabels(e.plannedOn).spoken}` : "not planned"}`;
        return (
          <View
            key={e.cabinetItemId}
            style={[paperStyles.row, styles.row, expired && styles.expired]}
            accessible
            accessibilityLabel={label}
            testID={`week-use-soon-${e.cabinetItemId}`}
          >
            <AppText variant="bodyS" weight="bold" style={styles.name}>
              {expired ? e.name : `${e.name} · ${daysLeftText(e.daysLeft)}`}
            </AppText>
            <View style={styles.status}>
              {planned ? <Check size={16} color={pantry.green} strokeWidth={3} /> : null}
              <AppText variant="caption" weight="semi" style={planned ? styles.green : paperStyles.pencil}>
                {status}
              </AppText>
            </View>
          </View>
        );
      })}
      {needsPlan ? (
        <Pressable
          onPress={onPlan}
          disabled={!canPlan}
          accessibilityRole="button"
          accessibilityLabel="Plan a dinner with these"
          accessibilityState={{ disabled: !canPlan }}
          style={({ pressed }) => [paperStyles.row, styles.plan, !canPlan && styles.expired, pressed && paperStyles.pressed]}
          testID="week-use-soon-plan"
        >
          <Sparkles size={20} color={pantry.green} />
          <AppText weight="display" style={[paperStyles.hand, styles.planText]}>
            Plan a dinner with these
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: PAPER_MARGIN_X, paddingRight: 16, paddingVertical: 8 },
  name: { flexShrink: 1, color: NOTE_PAPER.ink },
  status: { flexDirection: "row", alignItems: "center", gap: 4 },
  green: { color: pantry.green },
  expired: { opacity: 0.55 },
  plan: { alignItems: "center", gap: 8, paddingLeft: PAPER_MARGIN_X - 2, minHeight: 44 },
  planText: { fontSize: 20, lineHeight: 26, color: pantry.green },
});
