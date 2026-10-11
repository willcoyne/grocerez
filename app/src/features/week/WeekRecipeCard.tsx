import type { MealPlanResponse, PlannedMeal } from "@contracts/mealPlan";
import { ArrowLeftRight, CalendarDays, CircleAlert, ListPlus, Trash2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useAddMissingToList, useMovePlannedMeal, useRemovePlannedMeal } from "@/api/hooks/mealPlan";
import { AgentMealCard } from "@/components/AgentMealCard";
import { AppText, useToast } from "@/components/ui";
import { makePaperStyles, PAPER_MARGIN_X } from "@/features/pantry/overlay/PaperSheet";
import { type OverlayPalette, shadowFor, useOverlayPalette, useOverlayStyles } from "@/features/pantry/overlay/palette";
import { confirm } from "@/lib/confirm";
import { plural } from "@/lib/format";

import { dayLabels, deadlinesBefore, moveConfirmTitle, warningText } from "./weekDates";

export type WeekRecipeCardProps = {
  groupId: string;
  planned: PlannedMeal;
  /** The week's dates, for "Move day". */
  dates: string[];
  /** For the move-past-deadline check. */
  expiring?: MealPlanResponse["expiring"];
  /** All planned dinners of the week, for the swap partner's deadline check. */
  allPlanned?: readonly PlannedMeal[];
  /** Swap is disabled while another agent run is going. */
  busy: boolean;
  onClose: () => void;
  /** Start an agent run that replaces this dinner (replacePlannedMealId). */
  onSwap: (planned: PlannedMeal) => void;
};

/**
 * A planned dinner as a paper recipe card that slides up over the Week sheet: AgentMealCard's content (photo, time and
 * servings, ingredient lines, our steps, citation, safety chip) plus Swap / Move day / Remove / Add missing to List.
 */
export function WeekRecipeCard({ groupId, planned, dates, expiring, allPlanned, busy, onClose, onSwap }: WeekRecipeCardProps) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const paper = useOverlayStyles(makePaperStyles);
  const insets = useSafeAreaInsets();
  const { show: toast } = useToast();
  const move = useMovePlannedMeal(groupId);
  const remove = useRemovePlannedMeal(groupId);
  const addMissing = useAddMissingToList(groupId);
  const [picking, setPicking] = useState(false);
  const [slide] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 9, tension: 80 }).start();
  }, [slide]);

  const meal = planned.meal;
  const day = dayLabels(planned.date);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  const moveTo = async (date: string) => {
    // Moving past a used item's expiry is allowed by the server; confirm first.
    // Moving onto a taken day swaps, so the partner dinner lands on this one's old (maybe later) date.
    const partner = allPlanned?.find((p) => p.date === date && p.id !== planned.id);
    const late = deadlinesBefore(planned, expiring, date);
    const partnerLate = partner ? deadlinesBefore(partner, expiring, planned.date) : [];
    if (late.length || partnerLate.length) {
      const detail = [
        late.length ? `${meal.title} would be on ${dayLabels(date).spoken}.` : "",
        partnerLate.length && partner ? `${partner.meal.title} would be on ${dayLabels(planned.date).spoken}.` : "",
      ].filter(Boolean).join(" ");
      const all = [...late, ...partnerLate];
      if (!(await confirm(moveConfirmTitle(...all), detail, "Move anyway"))) return;
    }
    move.mutate(
      { id: planned.id, date },
      {
        onSuccess: () => {
          toast(`Moved ${meal.title} to ${dayLabels(date).short}`);
          onClose();
        },
        onError,
      },
    );
  };

  async function onRemove() {
    if (!(await confirm(`Remove ${meal.title}?`, `${day.spoken} goes back to empty.`, "Remove", true))) return;
    remove.mutate(planned.id, {
      onSuccess: () => {
        toast(`Removed ${meal.title}`);
        onClose();
      },
      onError,
    });
  }

  const onAddMissing = () =>
    addMissing.mutate(planned.id, {
      onSuccess: (res) =>
        toast(
          res.added > 0
            ? `Added ${plural(res.added, "item")} to the list${res.skipped.length ? ` · ${res.skipped.length} skipped (already have)` : ""}`
            : res.skipped.length
              ? "Everything is already on the list or in the cabinet"
              : "Nothing to add",
        ),
      onError,
    });

  return (
    <View style={StyleSheet.absoluteFill} testID="week-card">
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close recipe card"
        testID="week-card-backdrop"
      />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.card,
          { paddingBottom: insets.bottom + 12, top: insets.top + 60 },
          { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [480, 0] }) }] },
        ]}
      >
        <View style={styles.margin} pointerEvents="none" />
        <View style={styles.head}>
          <AppText variant="micro" style={styles.day} accessibilityRole="header">
            {day.section}
          </AppText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close recipe card"
            hitSlop={6}
            style={styles.close}
            testID="week-card-close"
          >
            <X size={22} color={P.oakInk} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* The household safety result stored when the dinner was saved; legacy rows (null) passed that check too. */}
          <AgentMealCard
            meal={meal}
            safety={{ title: meal.title, ...(planned.safety ?? { passes: true, unknown: [] }) }}
            style={styles.meal}
          />
          {planned.warnings.map((w) => (
            <View key={w.item} style={styles.chip} accessible accessibilityLabel={`Warning: ${warningText(w)}`} testID="week-card-warning">
              <CircleAlert size={16} color={P.redInk} />
              <AppText variant="caption" weight="bold" style={styles.dangerText}>
                {warningText(w)}
              </AppText>
            </View>
          ))}

          {picking ? (
            <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Move to which day">
              {dates.map((d) => {
                const current = d === planned.date;
                return (
                  <Pressable
                    key={d}
                    accessibilityRole="radio"
                    accessibilityLabel={dayLabels(d).spoken}
                    accessibilityState={{ checked: current, selected: current, disabled: current || move.isPending }}
                    disabled={current || move.isPending}
                    onPress={() => void moveTo(d)}
                    style={({ pressed }) => [styles.dayChip, current && styles.dayChipOn, pressed && paper.pressed]}
                    testID={`week-card-move-${d}`}
                  >
                    <AppText variant="caption" weight="bold" style={current ? styles.dayChipOnText : styles.dayChipText}>
                      {dayLabels(d).section}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.actions}>
            <CardAction
              icon={<ArrowLeftRight size={18} color={P.oakInk} />}
              label="Swap"
              hint="The agent finds a different dinner for this day"
              disabled={busy}
              onPress={() => onSwap(planned)}
              testID="week-card-swap"
            />
            <CardAction
              icon={<CalendarDays size={18} color={P.oakInk} />}
              label="Move day"
              onPress={() => setPicking(!picking)}
              testID="week-card-move"
            />
            <CardAction
              icon={<ListPlus size={18} color={P.oakInk} />}
              label="Add missing to List"
              loading={addMissing.isPending}
              onPress={onAddMissing}
              testID="week-card-add-missing"
            />
            <CardAction
              icon={<Trash2 size={18} color={P.redInk} />}
              label="Remove"
              danger
              loading={remove.isPending}
              onPress={() => void onRemove()}
              testID="week-card-remove"
            />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function CardAction({
  icon,
  label,
  hint,
  onPress,
  disabled,
  loading,
  danger,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const paper = useOverlayStyles(makePaperStyles);
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [styles.action, off && styles.actionOff, pressed && !off && paper.pressed]}
      testID={testID}
    >
      {icon}
      <AppText variant="bodyS" weight="bold" style={danger ? styles.dangerText : styles.actionText}>
        {label}
      </AppText>
    </Pressable>
  );
}

const makeStyles = (P: OverlayPalette) =>
  StyleSheet.create({
  backdrop: { backgroundColor: P.backdrop },
  card: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 0,
    backgroundColor: P.notePaper,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 10,
    ...shadowFor(P),
  },
  margin: { position: "absolute", top: 0, bottom: 0, left: PAPER_MARGIN_X - 10, width: 2, backgroundColor: P.noteMargin },
  head: { flexDirection: "row", alignItems: "center", paddingLeft: PAPER_MARGIN_X, paddingRight: 8 },
  day: { flex: 1, color: P.oakDark, letterSpacing: 1.2 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingLeft: PAPER_MARGIN_X - 2, paddingRight: 14, paddingBottom: 24, gap: 12 },
  meal: { backgroundColor: P.notePaper, borderColor: P.noteRule },
  picker: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: P.oakInk,
    justifyContent: "center",
  },
  dayChipOn: { backgroundColor: P.green, borderColor: P.green },
  dayChipText: { color: P.oakInk },
  dayChipOnText: { color: "#FFFFFF" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: P.noteRule,
    backgroundColor: "#FFFFFF",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: P.redTint,
  },
  actionOff: { opacity: 0.5 },
  actionText: { color: P.oakInk },
  dangerText: { color: P.redInk },
});
