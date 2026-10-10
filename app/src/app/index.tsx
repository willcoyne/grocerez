import { ALLERGENS } from "@contracts/dietary";
import { StyleSheet, Text, View } from "react-native";

import { HealthBadge } from "@/components/HealthBadge";
import { colors, fontSize, spacing } from "@/theme";

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>GrocerEZ</Text>
      <HealthBadge />
      <Text>{ALLERGENS.length} allergens tracked</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  title: { fontSize: fontSize.xxl, fontWeight: "800", color: colors.primary },
});
