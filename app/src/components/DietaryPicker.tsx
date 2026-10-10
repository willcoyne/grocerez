import { type Allergen, ALLERGENS, type Diet, DIETS } from "@contracts/dietary";
import { StyleSheet, Text, View } from "react-native";

import { labelize } from "@/lib/format";
import { colors, fontSize, spacing } from "@/theme";
import { Chip } from "./ui";

export interface DietaryValue {
  diets: Diet[];
  allergens: Allergen[];
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Chip multi-selects for diets and allergens. Values come from the server contract (@contracts/dietary). */
export function DietaryPicker({ value, onChange }: { value: DietaryValue; onChange: (v: DietaryValue) => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label} accessibilityRole="header">
        Diets
      </Text>
      <View style={styles.chips}>
        {DIETS.map((d) => (
          <Chip
            key={d}
            label={labelize(d)}
            selected={value.diets.includes(d)}
            onPress={() => onChange({ ...value, diets: toggle(value.diets, d) })}
          />
        ))}
      </View>
      <Text style={styles.label} accessibilityRole="header">
        Allergens
      </Text>
      <View style={styles.chips}>
        {ALLERGENS.map((a) => (
          <Chip
            key={a}
            label={labelize(a)}
            tone={value.allergens.includes(a) ? "danger" : "neutral"}
            selected={value.allergens.includes(a)}
            accessibilityLabel={`Allergic to ${labelize(a)}`}
            onPress={() => onChange({ ...value, allergens: toggle(value.allergens, a) })}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
