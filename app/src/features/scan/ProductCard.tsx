/**
 * Label card for a scanned product: brand/name/image, Nutri-Score, a Nutrition-Facts style panel, collapsible ingredients,
 * Contains / May contain chips with household allergy warnings, and where the data came from. Presentational.
 */
import type { Allergen } from "@contracts/dietary";
import type { Product } from "@contracts/products";
import { Image } from "expo-image";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { labelize } from "@/lib/format";

import { labelConflicts, peopleText, whoReacts, type AllergenAudience } from "./allergens";
import { fmtAmount, productLabelView, type LabelFacts, type LabelView } from "./labelView";
import { fixed, NUTRI_SCORE, useThemeUi } from "./scanTheme";

export type ProductCardProps = {
  product: Product;
  /** Household allergy context (useAllergenAudience(groupId)). */
  audience: AllergenAudience;
  testID?: string;
};

export function ProductCard({ product, audience, testID = "product-card" }: ProductCardProps) {
  const ui = useThemeUi();
  const view: LabelView = productLabelView(product);
  const hits = labelConflicts([...view.allergens, ...view.mayContain], audience);
  const text = { color: ui.text };
  const muted = { color: ui.textMuted };

  return (
    <View style={styles.wrap} testID={testID}>
      {hits.length > 0 ? <AllergyBanner hits={hits} view={view} /> : null}

      <View style={styles.top}>
        {view.imageUrl ? (
          <Image source={{ uri: view.imageUrl }} style={styles.image} contentFit="contain" accessibilityLabel={view.name} />
        ) : null}
        <View style={styles.flex}>
          {view.brand ? (
            <AppText variant="caption" weight="semi" style={muted}>
              {view.brand}
            </AppText>
          ) : null}
          <AppText variant="bodyL" weight="heavy" style={text} accessibilityRole="header" testID={`${testID}-name`}>
            {view.name}
          </AppText>
        </View>
        {view.healthScore ? <NutriScore letter={view.healthScore} /> : null}
      </View>

      {view.facts ? (
        <FactsPanel facts={view.facts} testID={`${testID}-facts`} />
      ) : (
        <AppText variant="bodyS" style={muted}>
          No nutrition facts on this label.
        </AppText>
      )}

      {view.ingredients ? <Ingredients text={view.ingredients} testID={`${testID}-ingredients`} /> : null}

      <AllergenChips title="Contains" list={view.allergens} audience={audience} testID={`${testID}-contains`} />
      <AllergenChips title="May contain" list={view.mayContain} audience={audience} testID={`${testID}-may-contain`} />

      <AppText variant="caption" style={muted} testID={`${testID}-source`}>
        {view.sourceTitle}
      </AppText>

    </View>
  );
}

function AllergyBanner({ hits, view }: { hits: ReturnType<typeof labelConflicts>; view: LabelView }) {
  const mine = hits.some((h) => h.mine);
  const fg = mine ? fixed.onDanger : fixed.dangerInk;
  const parts = hits.map((h) => {
    const may = !view.allergens.includes(h.allergen);
    return `${may ? "may contain " : ""}${labelize(h.allergen).toLowerCase()} (${peopleText(h)})`;
  });
  const sentence = `Allergy warning: ${parts.join(", ")}`;
  return (
    <View
      style={[styles.banner, { backgroundColor: mine ? fixed.danger : fixed.dangerTint, borderColor: fixed.danger }]}
      accessibilityRole="alert"
      accessible
      accessibilityLabel={sentence}
      testID="allergy-banner"
    >
      <TriangleAlert size={20} color={fg} strokeWidth={2.5} />
      <AppText variant="bodyS" weight="heavy" style={[styles.flex, { color: fg }]}>
        {sentence}
      </AppText>
    </View>
  );
}

function NutriScore({ letter }: { letter: string }) {
  const L = letter.toUpperCase();
  return (
    <View style={styles.score} accessible accessibilityLabel={`Nutri-Score ${L}`} testID="nutri-score">
      <AppText variant="micro" weight="bold" style={styles.scoreTitle} uppercase={false}>
        Nutri-Score
      </AppText>
      <View style={styles.scoreRow}>
        {NUTRI_SCORE.map((s) => {
          const on = s.letter === L;
          return (
            <View key={s.letter} style={[styles.scoreCell, { backgroundColor: s.bg }, on && styles.scoreOn]}>
              <AppText variant={on ? "bodyL" : "micro"} weight="heavy" style={{ color: s.fg }} uppercase={false}>
                {s.letter}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type Row = { key: keyof LabelFacts; label: string; unit: "g" | "mg"; indent?: boolean; bold?: boolean };
const ROWS: Row[] = [
  { key: "fat_g", label: "Total Fat", unit: "g", bold: true },
  { key: "sat_fat_g", label: "Saturated Fat", unit: "g", indent: true },
  { key: "sodium_mg", label: "Sodium", unit: "mg", bold: true },
  { key: "carbs_g", label: "Total Carbohydrate", unit: "g", bold: true },
  { key: "fiber_g", label: "Dietary Fiber", unit: "g", indent: true },
  { key: "sugar_g", label: "Total Sugars", unit: "g", indent: true },
  { key: "protein_g", label: "Protein", unit: "g", bold: true },
];

/** Black-on-white Nutrition Facts panel (the same in every theme, like the real thing). */
export function FactsPanel({ facts, testID = "nutrition-facts" }: { facts: LabelFacts; testID?: string }) {
  const per = facts.basis === "100g" ? "per 100 g" : "per serving";
  const rows = ROWS.filter((r) => typeof facts[r.key] === "number");
  const ink = { color: fixed.labelInk };
  return (
    <View style={styles.facts} testID={testID} accessibilityLabel={`Nutrition facts ${per}`}>
      <AppText variant="h1" weight="heavy" style={[ink, styles.factsTitle]} accessibilityRole="header">
        Nutrition Facts
      </AppText>
      {facts.servingSize ? (
        <View style={styles.factsRow}>
          <AppText variant="bodyS" weight="heavy" style={ink}>
            Serving size
          </AppText>
          <AppText variant="bodyS" weight="heavy" style={[ink, styles.shrink]} testID={`${testID}-serving`}>
            {facts.servingSize}
          </AppText>
        </View>
      ) : null}
      <View style={styles.ruleThick} />
      <AppText variant="micro" weight="bold" style={ink} uppercase={false}>
        {facts.basis === "100g" ? "Amount per 100 g" : "Amount per serving"}
      </AppText>
      <View style={styles.calRow} accessible accessibilityLabel={facts.calories === null ? "Calories unknown" : `${Math.round(facts.calories)} calories ${per}`}>
        <AppText variant="tabTitle" weight="heavy" style={ink}>
          Calories
        </AppText>
        <AppText variant="hero" weight="heavy" style={ink} testID={`${testID}-calories`}>
          {facts.calories === null ? "–" : String(Math.round(facts.calories))}
        </AppText>
      </View>
      <View style={styles.ruleMid} />
      {rows.map((r) => {
        const v = facts[r.key] as number;
        return (
          <View key={r.key} style={[styles.factsRow, styles.factsLine, r.indent && styles.indent]} accessible
            accessibilityLabel={`${r.label} ${fmtAmount(v)} ${r.unit === "g" ? "grams" : "milligrams"}`} testID={`${testID}-${r.key}`}>
            <AppText variant="bodyS" style={ink}>
              <AppText variant="bodyS" weight={r.bold ? "heavy" : "medium"} style={ink}>
                {r.label}
              </AppText>
              {` ${fmtAmount(v)}${r.unit}`}
            </AppText>
          </View>
        );
      })}
      {rows.length === 0 ? (
        <AppText variant="caption" style={ink}>
          Only calories are known for this one.
        </AppText>
      ) : null}
      <View style={styles.ruleThick} />
    </View>
  );
}

function Ingredients({ text, testID }: { text: string; testID: string }) {
  const ui = useThemeUi();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.gapXs}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide ingredients" : "Show ingredients"}
        accessibilityState={{ expanded: open }}
        style={styles.disclosure}
        testID={`${testID}-toggle`}
      >
        <AppText variant="bodyS" weight="heavy" style={{ color: ui.text }}>
          Ingredients
        </AppText>
        {open ? <ChevronUp size={20} color={ui.text} /> : <ChevronDown size={20} color={ui.text} />}
      </Pressable>
      <AppText variant="bodyS" style={{ color: ui.textMuted }} numberOfLines={open ? undefined : 2} testID={testID}>
        {text}
      </AppText>
    </View>
  );
}

function AllergenChips({ title, list, audience, testID }: { title: string; list: Allergen[]; audience: AllergenAudience; testID: string }) {
  const ui = useThemeUi();
  if (list.length === 0) return null;
  // The signed-in user's allergens first, then other members', then the rest.
  const sorted = [...list].map((a) => whoReacts(a, audience)).sort((x, y) => rank(x) - rank(y));
  return (
    <View style={styles.gapXs} testID={testID}>
      <AppText variant="caption" weight="bold" style={{ color: ui.textMuted }}>
        {title}
      </AppText>
      <View style={styles.chips}>
        {sorted.map((h) => {
          const name = labelize(h.allergen);
          const who = peopleText(h);
          const bg = h.mine ? fixed.danger : h.others.length ? fixed.dangerTint : fixed.neutralChip;
          const fg = h.mine ? fixed.onDanger : h.others.length ? fixed.dangerInk : fixed.neutralInk;
          const warn = h.mine || h.others.length > 0;
          return (
            <View
              key={h.allergen}
              style={[styles.chip, { backgroundColor: bg }, warn && { borderColor: fixed.danger, borderWidth: 1.5 }]}
              accessible
              accessibilityLabel={
                warn ? `${title} ${name}. ${h.mine ? (h.others.length ? `You and ${h.others.join(", ")} are` : "You are") : `${who} ${h.others.length > 1 ? "are" : "is"}`} allergic` : `${title} ${name}`
              }
              testID={`${testID}-${h.allergen}`}
            >
              {warn ? <TriangleAlert size={14} color={fg} strokeWidth={2.75} /> : null}
              <AppText variant="bodyS" weight={warn ? "heavy" : "semi"} style={{ color: fg }}>
                {warn ? `${name} · ${who}` : name}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const rank = (h: { mine: boolean; others: string[] }) => (h.mine ? 0 : h.others.length ? 1 : 2);

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1, textAlign: "right" },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  image: { width: 72, height: 72, borderRadius: 10, backgroundColor: "#FFFFFF" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1.5 },
  score: { alignItems: "center", gap: 2 },
  scoreTitle: { color: "#3E3A33" },
  scoreRow: { flexDirection: "row", alignItems: "center", borderRadius: 8, overflow: "hidden" },
  scoreCell: { width: 18, height: 26, alignItems: "center", justifyContent: "center" },
  scoreOn: { width: 28, height: 36, borderRadius: 8, borderWidth: 2, borderColor: "#FFFFFF" },
  facts: { backgroundColor: fixed.labelPaper, borderWidth: 2, borderColor: fixed.labelInk, padding: 10, gap: 2 },
  factsTitle: { letterSpacing: -0.5 },
  factsRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "baseline" },
  factsLine: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: fixed.labelInk, paddingVertical: 3 },
  indent: { paddingLeft: 16 },
  calRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap" },
  ruleThick: { height: 8, backgroundColor: fixed.labelInk, marginVertical: 4 },
  ruleMid: { height: 4, backgroundColor: fixed.labelInk, marginVertical: 2 },
  gapXs: { gap: 4 },
  disclosure: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 30, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
});
