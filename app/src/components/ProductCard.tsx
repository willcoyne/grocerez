import type { Allergen } from "@contracts/dietary";
import type { Product } from "@contracts/products";
import { Image } from "expo-image";
import { TriangleAlert } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import type { HouseholdAllergens } from "@/api/hooks/products";
import { labelize } from "@/lib/format";
import { AppText, SectionLabel, StatusChip } from "@/components/ui";
import { color, radius, space } from "@/theme";

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
      <AppText variant="caption" weight="bold" color="ink2">
        {title}
      </AppText>
      <View style={styles.chips}>
        {list.map((a) => {
          const who = household.get(a);
          return (
            <StatusChip
              key={a}
              tone={who ? "danger" : "neutral"}
              icon={who ? TriangleAlert : undefined}
              label={who ? `${labelize(a)} · ${who.join(", ")}` : labelize(a)}
              accessibilityLabel={who ? `${title} ${labelize(a)}. ${who.join(", ")} is allergic` : `${title} ${labelize(a)}`}
            />
          );
        })}
      </View>
    </View>
  );
}

const SOURCE: Record<Product["source"], string> = { smartlabel: "SmartLabel", openfoodfacts: "Open Food Facts", manual: "Manual" };

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
          {product.brand ? (
            <AppText variant="caption" weight="semi" color="muted">
              {product.brand}
            </AppText>
          ) : null}
          <AppText variant="bodyL" weight="heavy">
            {product.name}
          </AppText>
          {product.caloriesPerServing !== null ? (
            <AppText variant="bodyS">
              {`${Math.round(product.caloriesPerServing)} kcal per serving${product.servingSize ? ` (${product.servingSize})` : ""}`}
            </AppText>
          ) : null}
          {product.healthScore ? <StatusChip tone="neutral" label={`Nutri-Score ${product.healthScore.toUpperCase()}`} /> : null}
        </View>
      </View>
      {rows.length > 0 ? (
        <View style={styles.table} accessibilityLabel={`Nutrition ${basis}`}>
          <SectionLabel>{`Nutrition (${basis})`}</SectionLabel>
          {rows.map(([k, label, unit]) => (
            <View key={k} style={styles.tr}>
              <AppText variant="bodyS">{label}</AppText>
              <AppText variant="bodyS" weight="semi">{`${String(n[k])} ${unit}`}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      <AllergenChips title="Contains" list={product.allergens} household={household} />
      <AllergenChips title="May contain" list={product.mayContain} household={household} />
      <AppText variant="caption" color="muted">{`Source: ${SOURCE[product.source] ?? "Manual"}`}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  top: { flexDirection: "row", gap: space.md },
  image: { width: 80, height: 80, borderRadius: radius.control, backgroundColor: color.bg },
  flex: { flex: 1, gap: 2 },
  gap: { gap: space.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  table: { gap: 2 },
  tr: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: color.border, paddingVertical: 4 },
});
