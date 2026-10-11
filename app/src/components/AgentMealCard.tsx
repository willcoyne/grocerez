import type { AgentPlan, PlanMeal } from "@contracts/agent";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AiLabel, Button, Card } from "@/components/ui";
import { colors, fontSize, spacing } from "@/theme";

type MealSafety = AgentPlan["safety"]["perMeal"][number];

/** The safety line, from the server's check (the app never decides safety itself). Symbol + words, not color alone. */
export function safetyText(safety: MealSafety | undefined): { text: string; ok: boolean } {
  if (!safety) return { text: "⚠ Not safety-checked", ok: false };
  if (!safety.passes) return { text: "⚠ Didn't pass the household safety check", ok: false };
  const unknown = safety.unknown.length ? ` · couldn't verify: ${safety.unknown.join(", ")}` : "";
  return { text: `✓ Safe for everyone${unknown}`, ok: true };
}

/** One proposed dinner: title, day, minutes, what it uses/needs, and the safety line. */
export function AgentMealCard({ meal, safety }: { meal: PlanMeal; safety: MealSafety | undefined }) {
  const [open, setOpen] = useState(false);
  const s = safetyText(safety);
  const meta = [meal.day, `${meal.minutes} min`, `serves ${meal.servings}`].filter(Boolean).join(" · ");
  const uses = meal.uses.length ? `uses: ${meal.uses.join(", ")}` : "uses: nothing from the cabinet";
  const missing = meal.missing.length ? `missing: ${meal.missing.join(", ")}` : "nothing to buy";

  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.title} accessibilityRole="header">
          {meal.title}
        </Text>
        <AiLabel text="AI" />
      </View>
      <Text style={styles.muted}>{meta}</Text>
      <Text style={styles.body}>
        {uses} · {missing}
      </Text>
      <Text style={[styles.safety, s.ok ? styles.safe : styles.unsafe]}>{s.text}</Text>
      <Button
        title={open ? "Hide steps" : "Show steps"}
        variant="ghost"
        compact
        accessibilityLabel={`${open ? "Hide" : "Show"} steps for ${meal.title}`}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <View style={styles.gap}>
          {meal.steps.map((step, i) => (
            <Text key={i} style={styles.body}>
              {i + 1}. {step}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: "800", color: colors.text, flex: 1 },
  body: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  safety: { fontSize: fontSize.sm, fontWeight: "600" },
  safe: { color: colors.success },
  unsafe: { color: colors.danger },
  gap: { gap: spacing.xs },
});
