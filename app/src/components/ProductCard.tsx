import type { Allergen } from "@contracts/dietary";
import type { Product } from "@contracts/products";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import type { HouseholdAllergens } from "@/api/hooks/products";
import { labelize } from "@/lib/format";
import { colors, fontSize, radius, spacing } from "@/theme";
import { Chip } from "./ui";

const NUTRIENTS: [string, string, string][] = [
  ["fat_g", "Fat", "g"],
  ["sat_fat_g", "Saturated fat", "g"],
  ["carbs_g", "Carbs", "g"],
  ["sugar_g", "Sugar", "g"],
  ["fiber_g", "Fiber", "g"],
  ["protein_g", "Protein", "g"],
  ["sodium_mg", "Sodium", "mg"],
];

/** Allergens in the product that a household member is allergic to (both lists come from the server). */
export function conflicts(product: Product, household: HouseholdAllergens): { allergen: Allergen; names: string[] }[] {
  return [...new Set([...product.allergens, ...product.mayContain])]
    .filter((a) => household.has(a))
    .map((a) => ({ allergen: a, names: household.get(a)! }));
}

function AllergenChips({ title, list, household }: { title: string; list: Allergen[]; household: HouseholdAllergens }) {
  if (list.length === 0) return null;
  return (
    <View style={styles.gap}>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.chips}>
        {list.map((a) => {
          const who = household.get(a);
          const text = who ? `⚠ ${labelize(a)} — ${who.join(", ")}` : labelize(a);
          return (
            <Chip
              key={a}
              tone={who ? "danger" : "neutral"}
              label={text}
              accessibilityLabel={who ? `${title} ${labelize(a)}. ${who.join(", ")} is allergic` : `${title} ${labelize(a)}`}
            />
          );
        })}
      </View>
    </View>
  );
}

/** Scan result / item detail product block: image, brand + name, calories, nutrients, allergens, health score, source. */
export function ProductCard({ product, household }: { product: Product; household: HouseholdAllergens }) {
  const n = product.nutrition ?? {};
  const basis = n.basis === "100g" ? "per 100 g" : "per serving";
  const rows = NUTRIENTS.filter(([k]) => n[k] !== undefined && n[k] !== null);
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={styles.image} contentFit="contain" accessibilityLabel={product.name} />
        ) : null}
        <View style={styles.flex}>
          {product.brand ? <Text style={styles.brand}>{product.brand}</Text> : null}
          <Text style={styles.name}>{product.name}</Text>
          {product.caloriesPerServing !== null ? (
            <Text style={styles.calories}>
              {Math.round(product.caloriesPerServing)} kcal per serving{product.servingSize ? ` (${product.servingSize})` : ""}
            </Text>
          ) : null}
          {product.healthScore ? <Text style={styles.muted}>Nutri-Score {product.healthScore.toUpperCase()}</Text> : null}
        </View>
      </View>
      {rows.length > 0 ? (
        <View style={styles.table} accessibilityLabel={`Nutrition ${basis}`}>
          <Text style={styles.label}>Nutrition ({basis})</Text>
          {rows.map(([k, label, unit]) => (
            <View key={k} style={styles.tr}>
              <Text style={styles.td}>{label}</Text>
              <Text style={styles.td}>
                {String(n[k])} {unit}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <AllergenChips title="Contains" list={product.allergens} household={household} />
      <AllergenChips title="May contain" list={product.mayContain} household={household} />
      <Text style={styles.muted}>Source: {product.source === "smartlabel" ? "SmartLabel" : product.source === "openfoodfacts" ? "Open Food Facts" : "Manual"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  top: { flexDirection: "row", gap: spacing.md },
  image: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.background },
  flex: { flex: 1, gap: 2 },
  brand: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "600" },
  name: { fontSize: fontSize.lg, fontWeight: "800", color: colors.text },
  calories: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  gap: { gap: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  label: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },
  table: { gap: 2 },
  tr: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 2 },
  td: { fontSize: fontSize.sm, color: colors.text },
});
