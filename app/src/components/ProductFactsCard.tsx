import type { Citation, ProductLookup } from "@contracts/products";
import { Linking, StyleSheet, View } from "react-native";

import { AiLabel, AppText, Card, StatusChip } from "@/components/ui";
import type { HouseholdAllergens } from "@/api/hooks/products";
import { formatCents, labelize } from "@/lib/format";
import { space } from "@/theme";

const PLACE = { pantry: "pantry", fridge: "fridge", freezer: "freezer" } as const;

const days = (n: number) => (n >= 60 ? `${Math.round(n / 30)} months` : n >= 14 ? `${Math.round(n / 7)} weeks` : `${n} days`);

function Sources({ sources }: { sources: Citation[] }) {
  if (sources.length === 0) return null;
  return (
    <View style={styles.sources}>
      <AppText variant="caption" weight="bold" color="muted">
        Sources
      </AppText>
      {sources.map((s) => (
        <AppText
          key={s.url}
          variant="caption"
          weight="semi"
          color="primary"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(s.url)}
          numberOfLines={2}
        >
          {s.quote ? `${s.title}: “${s.quote}”` : s.title}
        </AppText>
      ))}
    </View>
  );
}

/** The AI product lookup result: max shelf life, regional price and allergens, each with the sources it came from. */
export function ProductFactsCard({ lookup, household }: { lookup: ProductLookup; household?: HouseholdAllergens }) {
  const { shelfLife, price, allergens, product } = lookup.result;
  const chip = (a: (typeof allergens.contains)[number], may: boolean) => {
    const who = household?.get(a);
    return (
      <StatusChip
        key={`${may ? "may" : "has"}-${a}`}
        label={`${may ? "May contain " : ""}${labelize(a)}${who?.length ? ` · ${who.join(", ")}` : ""}`}
        tone={who?.length ? "danger" : may ? "warn" : "neutral"}
      />
    );
  };
  return (
    <Card style={styles.card} testID="product-facts">
      <View style={styles.row}>
        <AiLabel text="AI estimate" />
        <AppText variant="caption" color="muted" numberOfLines={1} style={styles.flex}>
          {[product.brand, product.name].filter(Boolean).join(" · ")}
        </AppText>
      </View>

      <AppText weight="heavy">Shelf life</AppText>
      {shelfLife ? (
        <>
          <AppText>{`Lasts up to ${days(shelfLife.maxDays)} in the ${PLACE[shelfLife.usualStorage]} (unopened)`}</AppText>
          {shelfLife.entries
            .filter((e) => !(e.storage === shelfLife.usualStorage && !e.opened))
            .map((e) => (
              <AppText key={`${e.storage}-${e.opened}`} variant="caption" color="muted">
                {`${labelize(e.storage)}${e.opened ? ", opened" : ""}: up to ${days(e.maxDays)}`}
              </AppText>
            ))}
          {shelfLife.notes ? <AppText variant="caption" color="muted">{shelfLife.notes}</AppText> : null}
          <Sources sources={shelfLife.sources} />
        </>
      ) : (
        <AppText color="muted">No sourced shelf-life data found.</AppText>
      )}

      <AppText weight="heavy">Price</AppText>
      {price ? (
        <>
          <AppText>{`About ${formatCents(price.typicalCents)} ${price.unit}`}</AppText>
          <AppText variant="caption" color="muted">{`${price.area}, ${price.asOf}${lookup.zipCode ? ` (for ZIP ${lookup.zipCode})` : ""}`}</AppText>
          <Sources sources={price.sources} />
        </>
      ) : (
        <AppText color="muted">No sourced price found for this item.</AppText>
      )}

      <AppText weight="heavy">Allergens</AppText>
      {allergens.contains.length || allergens.mayContain.length ? (
        <View style={styles.chips}>
          {allergens.contains.map((a) => chip(a, false))}
          {allergens.mayContain.map((a) => chip(a, true))}
        </View>
      ) : (
        <AppText color="muted">None listed.</AppText>
      )}
      <AppText variant="caption" color="muted">{allergens.basis}</AppText>
      <Sources sources={allergens.sources} />
      <AppText variant="caption" weight="semi" color="muted">
        Check the package label. Allergen info here is an estimate.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  sources: { gap: 2 },
  flex: { flex: 1 },
});
