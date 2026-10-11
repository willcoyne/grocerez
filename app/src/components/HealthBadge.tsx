import { StyleSheet, View } from "react-native";

import { useHealth } from "@/api/hooks/health";
import { AppText } from "@/components/ui";
import { config } from "@/config";
import { color, space } from "@/theme";

/** "Server OK" / "Server unreachable" line, so a teammate can check EXPO_PUBLIC_API_URL from the phone. */
export function HealthBadge() {
  const health = useHealth();
  const ok = health.data?.ok === true;
  const label = health.isPending ? "Checking server…" : ok ? "Server OK" : "Server unreachable";
  const dot = health.isPending ? color.checkboxIdle : ok ? color.okFg : color.dangerFg;
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label} at ${config.apiUrl}`}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <AppText variant="caption" color="muted">
        {`${label} · ${config.apiUrl}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
