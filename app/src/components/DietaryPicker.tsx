import { type Allergen, ALLERGENS, type Diet, DIETS } from "@contracts/dietary";
import { StyleSheet, View } from "react-native";

import { SectionLabel, ToggleChip } from "@/components/ui";
import { labelize } from "@/lib/format";
import { space } from "@/theme";

export interface DietaryValue {
  diets: Diet[];
  allergens: Allergen[];
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** ToggleChips for diets and allergies (DESIGN.md §4.7). Values come from the server contract (@contracts/dietary). */
export function DietaryPicker({ value, onChange }: { value: DietaryValue; onChange: (v: DietaryValue) => void }) {
  return (
    <View style={styles.wrap}>
      <SectionLabel>Diet</SectionLabel>
      <View style={styles.chips}>
        {DIETS.map((d) => (
          <ToggleChip
            key={d}
            label={labelize(d)}
            selected={value.diets.includes(d)}
            onPress={() => onChange({ ...value, diets: toggle(value.diets, d) })}
            testID={`diet-${d}`}
          />
        ))}
      </View>
      <SectionLabel style={styles.gapTop}>Allergies</SectionLabel>
      <View style={styles.chips}>
        {ALLERGENS.map((a) => (
          <ToggleChip
            key={a}
            label={labelize(a)}
            selected={value.allergens.includes(a)}
            onPress={() => onChange({ ...value, allergens: toggle(value.allergens, a) })}
            testID={`allergen-${a}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  gapTop: { marginTop: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
