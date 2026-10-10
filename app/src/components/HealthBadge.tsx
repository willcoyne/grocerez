import { StyleSheet, Text, View } from "react-native";

import { useHealth } from "@/api/hooks/health";
import { config } from "@/config";
import { colors, fontSize, spacing } from "@/theme";

/** "Server OK" / "Server unreachable" line, so a teammate can check EXPO_PUBLIC_API_URL from the phone. */
export function HealthBadge() {
  const health = useHealth();
  const ok = health.data?.ok === true;
  const label = health.isPending ? "Checking server…" : ok ? "Server OK" : "Server unreachable";
  return (
    <View style={styles.row} accessibilityLabel={`${label} at ${config.apiUrl}`}>
      <Text style={[styles.dot, { color: health.isPending ? colors.textMuted : ok ? colors.success : colors.danger }]}>
        {ok ? "●" : "○"}
      </Text>
      <Text style={styles.text}>
        {label} · {config.apiUrl}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { fontSize: fontSize.sm },
  text: { fontSize: fontSize.xs, color: colors.textMuted },
});
