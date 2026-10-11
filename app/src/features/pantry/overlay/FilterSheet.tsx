import { ALLERGENS, type Allergen } from "@contracts/dietary";
import { Ban, Check, ShieldCheck, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";

import { AppText } from "@/components/ui";
import { pressedOpacity, size } from "@/theme";

import { EMPTY_FILTERS, SHELF_GROUPS, type PantryFilters } from "../types";
import { FilterChip } from "./Chip";
import { CALORIE_STEPS, GROUP_LABEL, NUTRI_SCORE, allergenLabel, pantry, softShadow } from "./palette";

export type FilterSheetProps = {
  visible: boolean;
  filters: PantryFilters;
  onChange: (next: PantryFilters) => void;
  onClose: () => void;
  /** The signed-in user's allergens (useDietary). Marked "You" and covered by "Safe for me". */
  myAllergens: Allergen[];
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Bottom sheet with Allergies / Nutrition / Shelf / Status filters. Pure UI: emits the next PantryFilters. */
export function FilterSheet({ visible, filters, onChange, onClose, myAllergens }: FilterSheetProps) {
  if (!visible) return null;
  const set = (patch: Partial<PantryFilters>) => onChange({ ...filters, ...patch });
  const hasMine = myAllergens.length > 0;
  const mineLabel = myAllergens.map(allergenLabel).join(", ");

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="pantry-filter-sheet">
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(160)}
        style={[StyleSheet.absoluteFill, styles.backdrop]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close filters"
          testID="pantry-filter-backdrop"
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.springify().damping(18)}
        exiting={SlideOutDown.duration(200)}
        style={[styles.sheet, softShadow]}
        accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.header}>
          <AppText variant="h1" accessibilityRole="header" style={styles.title}>
            Filters
          </AppText>
          <Pressable
            onPress={() => onChange(EMPTY_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel="Reset filters"
            testID="pantry-filter-reset"
            style={({ pressed }) => [styles.textBtn, pressed && { opacity: pressedOpacity }]}>
            <AppText variant="bodyS" weight="bold" style={{ color: pantry.oakDark }}>
              Reset
            </AppText>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section title="Allergies">
            <ToggleRow
              testID="pantry-filter-safe"
              icon={<ShieldCheck size={22} color={pantry.green} />}
              title="Safe for me"
              subtitle={hasMine ? `Hide anything with ${mineLabel}` : "Add your allergies on the Me note to use this"}
              value={filters.safeForMe}
              disabled={!hasMine}
              onToggle={() => set({ safeForMe: !filters.safeForMe })}
            />
            <AppText variant="caption" style={styles.hint}>
              Hide items that contain:
            </AppText>
            <View style={styles.wrap}>
              {ALLERGENS.map((a) => {
                const mine = myAllergens.includes(a);
                const covered = mine && filters.safeForMe;
                const selected = covered || filters.excludeAllergens.includes(a);
                const name = allergenLabel(a);
                return (
                  <FilterChip
                    key={a}
                    testID={`pantry-filter-allergen-${a}`}
                    label={name}
                    accessibilityLabel={`Hide ${name}${mine ? ", one of your allergies" : ""}${covered ? ", covered by Safe for me" : ""}`}
                    selected={selected}
                    selectedBg={pantry.redInk}
                    idleBorder={mine ? pantry.red : undefined}
                    icon={<Ban size={16} color="#FFFFFF" strokeWidth={2.75} />}
                    onPress={() => {
                      if (!covered) set({ excludeAllergens: toggle(filters.excludeAllergens, a) });
                    }}
                    accessory={mine ? <YouTag inverted={selected} /> : undefined}
                  />
                );
              })}
            </View>
          </Section>

          <Section title="Nutrition">
            <AppText variant="caption" style={styles.hint}>
              Nutri-Score
            </AppText>
            <View style={styles.wrap}>
              {NUTRI_SCORE.map(({ letter, bg, fg }) => {
                const selected = filters.healthScores.includes(letter);
                return (
                  <Pressable
                    key={letter}
                    testID={`pantry-filter-score-${letter}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Nutri-Score ${letter.toUpperCase()}`}
                    accessibilityState={{ selected }}
                    onPress={() => set({ healthScores: toggle(filters.healthScores, letter) })}
                    style={({ pressed }) => [
                      styles.score,
                      { borderColor: bg },
                      selected && { backgroundColor: bg },
                      pressed && { opacity: pressedOpacity },
                    ]}>
                    <AppText variant="bodyL" weight="heavy" style={{ color: selected ? fg : pantry.ink }}>
                      {letter.toUpperCase()}
                    </AppText>
                    {selected ? (
                      <Check size={12} color={fg} strokeWidth={3.5} style={styles.scoreMark} />
                    ) : (
                      <View style={[styles.scoreDot, { backgroundColor: bg }]} />
                    )}
                  </Pressable>
                );
              })}
            </View>
            <AppText variant="caption" style={styles.hint}>
              Calories per serving
            </AppText>
            <View style={styles.wrap} accessibilityRole="radiogroup">
              {CALORIE_STEPS.map((step) => {
                const selected = filters.maxCalories === step;
                return (
                  <Pressable
                    key={String(step)}
                    testID={`pantry-filter-cal-${step ?? "any"}`}
                    accessibilityRole="radio"
                    accessibilityLabel={step == null ? "Any calories" : `At most ${step} calories`}
                    accessibilityState={{ checked: selected }}
                    onPress={() => set({ maxCalories: step })}
                    style={({ pressed }) => [
                      styles.segment,
                      selected && styles.segmentOn,
                      pressed && { opacity: pressedOpacity },
                    ]}>
                    <AppText variant="bodyS" weight="bold" style={{ color: selected ? "#FFFFFF" : pantry.ink }}>
                      {step == null ? "Any" : `≤ ${step}`}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title="Shelf">
            <View style={styles.wrap}>
              {SHELF_GROUPS.map((g) => (
                <FilterChip
                  key={g}
                  testID={`pantry-filter-group-${g}`}
                  label={GROUP_LABEL[g]}
                  accessibilityLabel={`${GROUP_LABEL[g]} shelf`}
                  selected={filters.groups.includes(g)}
                  onPress={() => set({ groups: toggle(filters.groups, g) })}
                />
              ))}
            </View>
          </Section>

          <Section title="Status">
            <ToggleRow
              testID="pantry-filter-expiring"
              title="Expiring soon"
              subtitle="Within 3 days"
              value={filters.expiringSoon}
              onToggle={() => set({ expiringSoon: !filters.expiringSoon })}
            />
            <ToggleRow
              testID="pantry-filter-low"
              title="Running low"
              value={filters.runningLow}
              onToggle={() => set({ runningLow: !filters.runningLow })}
            />
          </Section>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            testID="pantry-filter-done"
            style={({ pressed }) => [styles.done, pressed && { opacity: pressedOpacity }]}>
            <AppText variant="bodyL" weight="bold" style={{ color: "#FFFFFF" }}>
              Done
            </AppText>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="micro" accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function YouTag({ inverted }: { inverted: boolean }) {
  return (
    <View style={[styles.you, inverted && styles.youInverted]}>
      <AppText variant="micro" weight="heavy" style={[styles.youText, { color: inverted ? pantry.redInk : "#FFFFFF" }]}>
        You
      </AppText>
    </View>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onToggle,
  disabled,
  icon,
  testID,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.toggleRow, pressed && { opacity: pressedOpacity }, disabled && styles.disabled]}>
      {icon}
      <View style={styles.toggleText}>
        <AppText variant="bodyL" weight="bold" style={{ color: pantry.ink }}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" style={{ color: pantry.muted }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.thumb, value && styles.thumbOn]}>
          {value ? (
            <Check size={14} color={pantry.green} strokeWidth={3} />
          ) : (
            <X size={14} color={pantry.muted} strokeWidth={3} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: pantry.backdrop },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    backgroundColor: pantry.cream,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 4,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: pantry.oak,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: "#D9C3A5", marginTop: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: { color: pantry.oakInk },
  textBtn: { minHeight: size.hit, minWidth: size.hit, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  section: { gap: 10, padding: 14, borderRadius: 20, backgroundColor: "#FFFDF8", borderWidth: 1, borderColor: "#EADBC6" },
  sectionTitle: { color: pantry.oakDark },
  hint: { color: pantry.muted },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  score: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: pantry.cream,
  },
  scoreMark: { position: "absolute", bottom: 3 },
  scoreDot: { position: "absolute", bottom: 6, width: 6, height: 6, borderRadius: 3 },
  segment: {
    minHeight: size.hit,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "#D9C3A5",
    backgroundColor: pantry.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentOn: { backgroundColor: pantry.oakDark, borderColor: pantry.oakDark },
  you: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: pantry.redInk },
  youInverted: { backgroundColor: "#FFFFFF" },
  youText: { letterSpacing: 0.5 },
  toggleRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 },
  toggleText: { flex: 1, gap: 2 },
  disabled: { opacity: 0.55 },
  track: { width: 52, height: 32, borderRadius: 16, backgroundColor: "#E3D5C2", padding: 3, justifyContent: "center" },
  trackOn: { backgroundColor: pantry.green },
  thumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  thumbOn: { alignSelf: "flex-end" },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: "#EADBC6" },
  done: {
    minHeight: size.btnLg,
    borderRadius: 26,
    backgroundColor: pantry.oakDark,
    alignItems: "center",
    justifyContent: "center",
  },
});
