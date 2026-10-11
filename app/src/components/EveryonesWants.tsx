import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet } from "@/api/hooks/cabinet";
import { usePreferences } from "@/api/hooks/preferences";
import { AppText, Card, DashedEmpty, ErrorState, LoadingState, StatusChip } from "@/components/ui";
import { space } from "@/theme";

/** Household tab → "Everyone's wants" (DESIGN.md §4.8): every member's preferences grouped by item, joined with the cabinet. */
export function EveryonesWants({ groupId, meId }: { groupId: string; meId?: string }) {
  const prefs = usePreferences(groupId, "all");
  const cabinet = useCabinet(groupId);
  const inStock = useMemo(
    () => new Set((cabinet.data ?? []).filter((c) => c.status !== "running_low").map((c) => c.itemId)),
    [cabinet.data],
  );
  const grouped = useMemo(() => {
    const byItem = new Map<string, { name: string; who: string[] }>();
    for (const p of prefs.data ?? []) {
      const entry = byItem.get(p.itemId) ?? { name: p.item.name, who: [] };
      const name = p.user.id === meId ? "you" : p.user.displayName;
      if (!entry.who.includes(name)) entry.who.push(name);
      byItem.set(p.itemId, entry);
    }
    return [...byItem.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [prefs.data, meId]);

  if (prefs.isPending) return <LoadingState />;
  if (prefs.isError) return <ErrorState message={errorMessage(prefs.error)} onRetry={() => void prefs.refetch()} />;
  if (grouped.length === 0) return <DashedEmpty>No one has added preferences yet.</DashedEmpty>;
  return (
    <View style={styles.list}>
      {grouped.map(([itemId, { name, who }]) => {
        const have = inStock.has(itemId);
        return (
          <Card key={itemId} style={styles.row} testID={`want-${itemId}`}>
            <View style={styles.flex}>
              <AppText variant="bodyL" weight="heavy">
                {name}
              </AppText>
              <AppText variant="caption" color="muted">{`Wanted by ${who.join(", ")}`}</AppText>
            </View>
            <StatusChip tone={have ? "ok" : "warn"} label={have ? "In cabinet" : "On the list"} />
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 10 },
  flex: { flex: 1, gap: 2 },
});
