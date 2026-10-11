import { useRouter } from "expo-router";
import { Sparkles } from "lucide-react-native";
import { useId } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppText, Card } from "@/components/ui";
import { color, font, maxFontScale, pressedOpacity, radius, size, space, typeScale } from "@/theme";

/**
 * Small controls for the Pantry Agent screens, styled like the kit (DESIGN.md §3) where the kit has no fit:
 * a multiline prompt (TextField is single-line), radio-style choice chips (ToggleChip is a button), and the
 * Household tab entry card (Button has no long-press).
 */

/** Labelled multiline text field (TextField look: visible label, 1px borderStrong, radius 12). */
export function AgentPromptInput({
  label,
  value,
  onChangeText,
  maxLength = 500,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  maxLength?: number;
}) {
  const labelId = useId();
  return (
    <View style={styles.field}>
      <AppText nativeID={labelId} variant="caption" weight="bold" color="ink2">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        value={value}
        onChangeText={onChangeText}
        multiline
        maxLength={maxLength}
        maxFontSizeMultiplier={maxFontScale}
        placeholderTextColor={color.muted}
        style={styles.input}
      />
    </View>
  );
}

/** One-of-many chips with radio semantics, inside a radiogroup (ToggleChip look). */
export function AgentChoiceChips<T>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="caption" weight="bold" color="ink2">
        {label}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.label}
              accessibilityRole="radio"
              accessibilityLabel={`${label} ${o.label}`}
              accessibilityState={{ checked: selected, selected }}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [styles.chip, selected ? styles.chipOn : styles.chipOff, pressed && { opacity: pressedOpacity }]}
            >
              <AppText variant="bodyS" weight="semi" color={selected ? "onPrimary" : "ink"}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Opens the Week sheet on the pantry (spec §13): the pantry tab opens it whenever `week` changes, so each tap sends a
 * fresh nonce. The /agent modal stays as the internal/dev view (and the recorded-run replay).
 */
export function openWeekSheet(router: ReturnType<typeof useRouter>) {
  router.navigate("/cabinet?station=week");
}

/**
 * Household tab: the prominent "Plan our week" action → the Week sheet on the pantry. Long-press opens the recorded-run
 * replay (/agent?replay=1) when `replay` is on.
 */
export function AgentEntryCard({ replay }: { replay: boolean }) {
  const router = useRouter();
  return (
    <Card style={styles.entry}>
      <View style={styles.entryHead}>
        <View style={styles.entryIcon}>
          <Sparkles size={18} color={color.primary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyL" weight="heavy">
            Plan our week
          </AppText>
          <AppText variant="caption" color="muted">
            Dinners from what&apos;s expiring, checked against everyone&apos;s allergies, with real recipes.
          </AppText>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Plan our week"
        accessibilityHint={replay ? "Opens the week on the pantry. Long-press to replay the last recorded run" : "Opens the week on the pantry"}
        onPress={() => openWeekSheet(router)}
        onLongPress={replay ? () => router.push("/agent?replay=1") : undefined}
        style={({ pressed }) => [styles.entryBtn, pressed && { opacity: pressedOpacity }]}
      >
        <Sparkles size={18} color={color.onPrimary} />
        <AppText variant="body" weight="bold" color="onPrimary">
          Plan our week
        </AppText>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  input: {
    minHeight: 104,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontFamily: font.bodyMedium,
    fontSize: typeScale.body[0],
    lineHeight: typeScale.body[1],
    color: color.ink,
    textAlignVertical: "top",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: size.hit, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center" },
  chipOff: { backgroundColor: color.surface, borderColor: color.borderStrong },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  entry: { gap: space.md, borderColor: color.okBg, borderWidth: 1 },
  entryHead: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  entryIcon: { width: size.avatar, height: size.avatar, borderRadius: size.avatar / 2, backgroundColor: color.okBg, alignItems: "center", justifyContent: "center" },
  entryBtn: {
    minHeight: size.btn,
    borderRadius: radius.control,
    backgroundColor: color.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  flex: { flex: 1 },
});
