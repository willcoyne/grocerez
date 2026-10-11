import type { PlannedMeal } from "@contracts/mealPlan";
import { ArrowLeftRight, CalendarDays, ListPlus, Trash2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useAddMissingToList, useMovePlannedMeal, useRemovePlannedMeal } from "@/api/hooks/mealPlan";
import { AgentMealCard } from "@/components/AgentMealCard";
import { AppText, useToast } from "@/components/ui";
import { NOTE_PAPER, PAPER_MARGIN_X, paperStyles } from "@/features/pantry/overlay/PaperSheet";
import { pantry, softShadow } from "@/features/pantry/overlay/palette";
import { confirm } from "@/lib/confirm";
import { plural } from "@/lib/format";

import { dayLabels } from "./weekDates";

export type WeekRecipeCardProps = {
  groupId: string;
  planned: PlannedMeal;
  /** The week's dates, for "Move day". */
  dates: string[];
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
export function WeekRecipeCard({ groupId, planned, dates, busy, onClose, onSwap }: WeekRecipeCardProps) {
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

  const moveTo = (date: string) =>
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
            <X size={22} color={NOTE_PAPER.pencil} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Saved dinners passed the server's household safety check when they were saved (apply / add re-check). */}
          <AgentMealCard meal={meal} safety={{ title: meal.title, passes: true, unknown: [] }} style={styles.meal} />

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
                    onPress={() => moveTo(d)}
                    style={({ pressed }) => [styles.dayChip, current && styles.dayChipOn, pressed && paperStyles.pressed]}
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
              icon={<ArrowLeftRight size={18} color={pantry.oakInk} />}
              label="Swap"
              hint="The agent finds a different dinner for this day"
              disabled={busy}
              onPress={() => onSwap(planned)}
              testID="week-card-swap"
            />
            <CardAction
              icon={<CalendarDays size={18} color={pantry.oakInk} />}
              label="Move day"
              onPress={() => setPicking(!picking)}
              testID="week-card-move"
            />
            <CardAction
              icon={<ListPlus size={18} color={pantry.oakInk} />}
              label="Add missing to List"
              loading={addMissing.isPending}
              onPress={onAddMissing}
              testID="week-card-add-missing"
            />
            <CardAction
              icon={<Trash2 size={18} color={pantry.redInk} />}
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
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [styles.action, off && styles.actionOff, pressed && !off && paperStyles.pressed]}
      testID={testID}
    >
      {icon}
      <AppText variant="bodyS" weight="bold" style={danger ? styles.dangerText : styles.actionText}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: pantry.backdrop },
  card: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 0,
    backgroundColor: NOTE_PAPER.paper,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 10,
    ...softShadow,
  },
  margin: { position: "absolute", top: 0, bottom: 0, left: PAPER_MARGIN_X - 10, width: 2, backgroundColor: NOTE_PAPER.margin },
  head: { flexDirection: "row", alignItems: "center", paddingLeft: PAPER_MARGIN_X, paddingRight: 8 },
  day: { flex: 1, color: pantry.oakDark, letterSpacing: 1.2 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingLeft: PAPER_MARGIN_X - 2, paddingRight: 14, paddingBottom: 24, gap: 12 },
  meal: { backgroundColor: NOTE_PAPER.paper, borderColor: NOTE_PAPER.rule },
  picker: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: NOTE_PAPER.pencil,
    justifyContent: "center",
  },
  dayChipOn: { backgroundColor: pantry.green, borderColor: pantry.green },
  dayChipText: { color: NOTE_PAPER.pencil },
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
    borderColor: NOTE_PAPER.rule,
    backgroundColor: "#FFFFFF",
  },
  actionOff: { opacity: 0.5 },
  actionText: { color: pantry.oakInk },
  dangerText: { color: pantry.redInk },
});
