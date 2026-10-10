import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { usePreferences } from "@/api/hooks/preferences";
import { colors, fontSize, spacing } from "@/theme";
import { ErrorState } from "./States";
import { Chip } from "./ui";

/** Group tab → "Everyone's wants" (read-only): the union of every member's preferences, grouped by item. */
export function EveryonesWants({ groupId }: { groupId: string }) {
  const prefs = usePreferences(groupId, "all");
  const grouped = useMemo(() => {
    const byItem = new Map<string, { name: string; who: string[] }>();
    for (const p of prefs.data ?? []) {
      const entry = byItem.get(p.itemId) ?? { name: p.item.name, who: [] };
      entry.who.push(p.user.displayName);
      byItem.set(p.itemId, entry);
    }
    return [...byItem.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [prefs.data]);

  if (prefs.isPending) return <Text style={styles.muted}>Loading…</Text>;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />;
  if (grouped.length === 0) return <Text style={styles.muted}>Nobody has added preferences yet.</Text>;
  return (
    <View style={styles.list}>
      {grouped.map(([itemId, { name, who }]) => (
        <View key={itemId} style={styles.row}>
          <Text style={styles.name}>{name}</Text>
          <Chip label={`wanted by: ${who.join(", ")}`} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { gap: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
});
