import type { AgentPlan, PlanMeal } from "@contracts/agent";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AiLabel, Button, Card } from "@/components/ui";
import { colors, fontSize, radius, spacing, TAP_TARGET } from "@/theme";

type MealSafety = AgentPlan["safety"]["perMeal"][number];
type MealSource = NonNullable<PlanMeal["source"]>;

/** How many source ingredient lines show before "Show all N". */
export const INGREDIENT_PREVIEW = 5;

/** The safety line, from the server's check (the app never decides safety itself). Symbol + words, not color alone. */
export function safetyText(safety: MealSafety | undefined): { text: string; ok: boolean } {
  if (!safety) return { text: "⚠ Not safety-checked", ok: false };
  if (!safety.passes) return { text: "⚠ Didn't pass the household safety check", ok: false };
  const unknown = safety.unknown.length ? ` · couldn't verify: ${safety.unknown.join(", ")}` : "";
  return { text: `✓ Safe for everyone${unknown}`, ok: true };
}

/**
 * One proposed dinner. With a `source` (a real web recipe, spec §11): photo, the recipe's ingredient lines, our short
 * steps, and a citation linking to the original. Without one: labeled "AI-created recipe" with the generic ingredients.
 * Split into small parts (MealPhoto, IngredientLines, Steps, Citation) so the design pass can restyle each.
 */
export function AgentMealCard({ meal, safety }: { meal: PlanMeal; safety: MealSafety | undefined }) {
  const s = safetyText(safety);
  const source = meal.source;
  const meta = [meal.day, `${meal.minutes} min`, `serves ${meal.servings}`].filter(Boolean).join(" · ");
  const uses = meal.uses.length ? `uses: ${meal.uses.join(", ")}` : "uses: nothing from the cabinet";
  const missing = meal.missing.length ? `missing: ${meal.missing.join(", ")}` : "nothing to buy";
  const showSourceTitle = !!source && source.title.trim().toLowerCase() !== meal.title.trim().toLowerCase();

  return (
    <Card>
      {source?.imageUrl ? <MealPhoto uri={source.imageUrl} title={source.title} /> : null}
      <Text style={styles.title} accessibilityRole="header">
        {meal.title}
      </Text>
      {showSourceTitle ? <Text style={styles.muted}>“{source.title}”</Text> : null}
      {source ? null : <AiLabel text="AI-created recipe" />}
      <Text style={styles.muted}>{meta}</Text>
      <Text style={styles.body}>
        {uses} · {missing}
      </Text>
      <Text style={[styles.safety, s.ok ? styles.safe : styles.unsafe]}>{s.text}</Text>

      {source && meal.ingredientLines.length ? (
        <IngredientLines lines={meal.ingredientLines} />
      ) : (
        <Text style={styles.body}>
          <Text style={styles.label}>Ingredients: </Text>
          {meal.ingredients.join(", ")}
        </Text>
      )}
      <Steps steps={meal.steps} />
      {source ? <Citation source={source} /> : null}
    </Card>
  );
}

function MealPhoto({ uri, title }: { uri: string; title: string }) {
  return (
    <Image
      source={{ uri }}
      style={styles.photo}
      contentFit="cover"
      transition={150}
      accessibilityLabel={`Photo of ${title}`}
      testID="agent-meal-photo"
    />
  );
}

/** The source's lines with quantities: first 5, then "Show all N". */
function IngredientLines({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false);
  const visible = all ? lines : lines.slice(0, INGREDIENT_PREVIEW);
  return (
    <View style={styles.gap}>
      <Text style={styles.label}>Ingredients</Text>
      {visible.map((line, i) => (
        <Text key={i} style={styles.body}>
          • {line}
        </Text>
      ))}
      {lines.length > INGREDIENT_PREVIEW ? (
        <Button title={all ? "Show fewer" : `Show all ${lines.length}`} variant="ghost" compact onPress={() => setAll(!all)} />
      ) : null}
    </View>
  );
}

/** Our own short steps (model-written, ≤ 6); the site's full method stays on the site. */
function Steps({ steps }: { steps: string[] }) {
  return (
    <View style={styles.gap}>
      <Text style={styles.label}>Steps</Text>
      {steps.map((step, i) => (
        <Text key={i} style={styles.body}>
          {i + 1}. {step}
        </Text>
      ))}
    </View>
  );
}

function Citation({ source }: { source: MealSource }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open the full recipe on ${source.site}`}
      onPress={() => void WebBrowser.openBrowserAsync(source.url)}
      style={({ pressed }) => [styles.citation, pressed && styles.pressed]}
    >
      <Text style={styles.link}>Recipe from {source.site} ↗</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  photo: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.border },
  title: { fontSize: fontSize.lg, fontWeight: "800", color: colors.text },
  label: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },
  body: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  safety: { fontSize: fontSize.sm, fontWeight: "600" },
  safe: { color: colors.success },
  unsafe: { color: colors.danger },
  gap: { gap: spacing.xs },
  citation: { minHeight: TAP_TARGET, justifyContent: "center", alignSelf: "flex-start" },
  link: { fontSize: fontSize.md, fontWeight: "700", color: colors.primary, textDecorationLine: "underline" },
  pressed: { opacity: 0.7 },
});
