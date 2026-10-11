import type { AgentPlan, PlanMeal } from "@contracts/agent";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AiLabel, AppText, Button, Card, StatusChip, type ChipTone } from "@/components/ui";
import { color, pressedOpacity, size, space } from "@/theme";

type MealSafety = AgentPlan["safety"]["perMeal"][number] & { problems?: { ingredient: string; reason: string }[] };
type MealSource = NonNullable<PlanMeal["source"]>;

/** How many source ingredient lines show before "Show all N". */
export const INGREDIENT_PREVIEW = 5;

/** The safety status, from the server's check (the app never decides safety itself). Text + icon, never color alone. */
export function safetyStatus(
  safety: MealSafety | undefined,
): { label: string; tone: ChipTone; unknown: string[]; problems: string[] } {
  if (!safety) return { label: "Not safety-checked", tone: "neutral", unknown: [], problems: [] };
  if (!safety.passes) {
    const problems = (safety.problems ?? []).map((p) => `${p.ingredient}: ${p.reason}`);
    return { label: "Didn't pass the safety check", tone: "danger", unknown: [], problems };
  }
  return { label: "Safe for everyone", tone: "ok", unknown: safety.unknown, problems: [] };
}

const SAFETY_ICON = { ok: ShieldCheck, danger: ShieldAlert, neutral: ShieldQuestion, warn: ShieldQuestion } as const;

/**
 * One proposed dinner, built to scan: a photo thumbnail beside the title, time and servings, and where the recipe comes from
 * (a cited web recipe, spec §11, or "AI-created recipe"). Then the household safety chip, what it uses and what to buy,
 * and collapsible ingredients and steps (closed by default to keep cards short).
 */
export function AgentMealCard({
  meal,
  safety,
  style,
}: {
  meal: PlanMeal;
  safety: MealSafety | undefined;
  /** Outer layout only (width, margins); the card makes no assumptions about where it sits (list, calendar cell). */
  style?: StyleProp<ViewStyle>;
}) {
  const source = meal.source;
  const s = safetyStatus(safety);
  const meta = [meal.day, `${meal.minutes} min`, `serves ${meal.servings}`].filter(Boolean).join(" · ");
  const showSourceTitle = !!source && source.title.trim().toLowerCase() !== meal.title.trim().toLowerCase();

  return (
    <Card style={[styles.card, style]}>
      <View style={styles.body}>
        {/* photo beside the heading (a full-width photo towered over the card on wide screens) */}
        <View style={styles.top}>
          {source?.imageUrl ? <MealPhoto uri={source.imageUrl} title={source.title} /> : null}
          <View style={styles.topText}>
            <View style={styles.head}>
              <AppText variant="bodyL" weight="heavy" accessibilityRole="header">
                {meal.title}
              </AppText>
              {showSourceTitle ? (
                <AppText variant="caption" color="muted">
                  {`“${source.title}”`}
                </AppText>
              ) : null}
              <AppText variant="caption" weight="semi" color="ink2">
                {meta}
              </AppText>
            </View>
            {source ? <Citation source={source} /> : <AiLabel text="AI-created recipe" />}
          </View>
        </View>

        <View style={styles.safety}>
          <StatusChip
            label={s.label}
            tone={s.tone}
            icon={SAFETY_ICON[s.tone]}
            accessibilityLabel={`Household safety check: ${s.label}`}
          />
          {s.problems.length ? <AppText variant="caption" color="muted">{s.problems.join("; ")}</AppText> : null}
          {s.unknown.length ? (
            <AppText variant="caption" color="muted">{`Couldn't verify: ${s.unknown.join(", ")}`}</AppText>
          ) : null}
        </View>

        <View style={styles.uses}>
          <AppText variant="caption" color="ink2">
            <AppText variant="caption" weight="bold" color="ink2">
              From your cabinet:{" "}
            </AppText>
            {meal.uses.length ? meal.uses.join(", ") : "nothing"}
          </AppText>
          <AppText variant="caption" color="ink2">
            <AppText variant="caption" weight="bold" color="ink2">
              To buy:{" "}
            </AppText>
            {meal.missing.length ? meal.missing.join(", ") : "nothing"}
          </AppText>
        </View>

        <Collapsible title="Ingredients" count={source && meal.ingredientLines.length ? meal.ingredientLines.length : meal.ingredients.length} mealTitle={meal.title}>
          {source && meal.ingredientLines.length ? (
            <IngredientLines lines={meal.ingredientLines} />
          ) : (
            <AppText variant="bodyS">{meal.ingredients.join(", ")}</AppText>
          )}
        </Collapsible>
        <Collapsible title="Steps" count={meal.steps.length} mealTitle={meal.title}>
          <Steps steps={meal.steps} />
        </Collapsible>
      </View>
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

/** A section that starts closed: "Ingredients · 6" with a chevron. */
function Collapsible({ title, count, mealTitle, children }: { title: string; count: number; mealTitle: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Hide" : "Show"} ${title.toLowerCase()} for ${mealTitle}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [styles.sectionHead, pressed && { opacity: pressedOpacity }]}
      >
        <AppText variant="bodyS" weight="bold" style={styles.flex}>
          {`${title} · ${count}`}
        </AppText>
        <Chevron size={18} color={color.ink2} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

/** The source's lines with quantities: first 5, then "Show all N". */
function IngredientLines({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false);
  const visible = all ? lines : lines.slice(0, INGREDIENT_PREVIEW);
  return (
    <View style={styles.lines}>
      {visible.map((line, i) => (
        <AppText key={i} variant="bodyS">{`• ${line}`}</AppText>
      ))}
      {lines.length > INGREDIENT_PREVIEW ? (
        <Button label={all ? "Show fewer" : `Show all ${lines.length}`} variant="ghost" size="sm" onPress={() => setAll(!all)} style={styles.left} />
      ) : null}
    </View>
  );
}

/** Our own short steps (model-written, ≤ 6); the site's full method stays on the site. */
function Steps({ steps }: { steps: string[] }) {
  return (
    <View style={styles.lines}>
      {steps.map((step, i) => (
        <AppText key={i} variant="bodyS">{`${i + 1}. ${step}`}</AppText>
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
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.citation, pressed && { opacity: pressedOpacity }]}
    >
      <AppText variant="bodyS" weight="bold" color="primary">{`Recipe from ${source.site} ↗`}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: "hidden" },
  photo: { width: 112, height: 112, borderRadius: 10, backgroundColor: color.segment },
  body: { padding: space.md, gap: space.md },
  top: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  topText: { flex: 1, gap: space.xs },
  head: { gap: 2 },
  citation: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: size.hit, alignSelf: "flex-start" },
  safety: { gap: space.xs },
  uses: { gap: 2 },
  section: { borderTopWidth: 1, borderTopColor: color.border },
  sectionHead: { flexDirection: "row", alignItems: "center", minHeight: size.hit, gap: space.sm },
  sectionBody: { paddingBottom: space.sm },
  lines: { gap: space.xs },
  left: { alignSelf: "flex-start", paddingHorizontal: 0 },
  flex: { flex: 1 },
});
