import { useRouter } from "expo-router";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAlerts, useDismissRecall } from "@/api/hooks/alerts";
import { expirationText, shortDate } from "@/lib/format";
import { colors, fontSize, spacing, TAP_TARGET } from "@/theme";
import { ExpirationPill } from "./Badges";
import { ErrorState } from "./States";
import { useToast } from "./Toast";
import { Button, Card, SectionHeader } from "./ui";

/** Group tab → Alerts: expiring soon (tap → ItemDetail, "Find recipes") and possible recalls (Dismiss). */
export function AlertsSection({ groupId }: { groupId: string }) {
  const alerts = useAlerts(groupId);
  const dismiss = useDismissRecall(groupId);
  const router = useRouter();
  const toast = useToast();

  const count = (alerts.data?.expiring.length ?? 0) + (alerts.data?.recalls.length ?? 0);
  return (
    <View>
      <SectionHeader title={`Alerts${count ? ` (${count})` : ""}`} />
      <Card>
        {alerts.isPending ? (
          <Text style={styles.muted}>Loading alerts…</Text>
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
        ) : count === 0 ? (
          <Text style={styles.muted}>Nothing expiring and no recalls. 👍</Text>
        ) : (
          <View style={styles.gap}>
            {alerts.data.expiring.length > 0 ? (
              <View style={styles.gap}>
                <View style={styles.rowBetween}>
                  <Text style={styles.label}>Expiring soon</Text>
                  <Button title="✨ Find recipes" variant="ghost" compact onPress={() => router.push("/recipes")} />
                </View>
                {alerts.data.expiring.map((c) => (
                  <Pressable
                    key={c.id}
                    style={styles.item}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.item.name}. ${expirationText(c)}. Open details`}
                    onPress={() => router.push(`/item-detail/${c.id}`)}
                  >
                    <Text style={styles.name}>{c.item.name}</Text>
                    <ExpirationPill expiresAt={c.expiresAt} source={c.expirationSource} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {alerts.data.recalls.map((r) => (
              <View key={r.id} style={styles.recall} accessibilityRole="alert">
                <Text style={styles.recallTitle}>⚠ Possible recall</Text>
                <Text style={styles.body}>
                  This <Text style={styles.italic}>may</Text> match your {r.cabinetItem.brand ? `${r.cabinetItem.brand} ` : ""}
                  {r.cabinetItem.name}. Check the package.
                </Text>
                <Text style={styles.muted}>{r.recall.productDescription}</Text>
                {r.recall.reason ? <Text style={styles.body}>Reason: {r.recall.reason}</Text> : null}
                <Text style={styles.muted}>
                  {[r.recall.classification, r.recall.firm, r.recall.reportDate ? shortDate(r.recall.reportDate.slice(0, 10)) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                <View style={styles.rowBetween}>
                  {r.recall.url ? (
                    <Button title="View FDA notice" variant="ghost" compact onPress={() => void Linking.openURL(r.recall.url!)} />
                  ) : (
                    <View />
                  )}
                  <Button
                    title="Dismiss"
                    variant="secondary"
                    compact
                    accessibilityLabel={`Dismiss recall alert for ${r.cabinetItem.name}`}
                    onPress={() => dismiss.mutate(r.id, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

/** Count for the Group tab badge. */
export function useAlertCount(groupId: string): number {
  const alerts = useAlerts(groupId);
  return (alerts.data?.expiring.length ?? 0) + (alerts.data?.recalls.length ?? 0);
}

/** In-app banner when a possible recall match exists (server push is a stretch goal). */
export function RecallBanner({ groupId }: { groupId: string }) {
  const alerts = useAlerts(groupId);
  const router = useRouter();
  const n = alerts.data?.recalls.length ?? 0;
  if (n === 0) return null;
  return (
    <Pressable style={styles.banner} accessibilityRole="button" onPress={() => router.push("/group")}>
      <Text style={styles.bannerText}>
        ⚠ {n} possible recall{n === 1 ? "" : "s"} for items in your cabinet. Check Alerts ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TAP_TARGET },
  name: { fontSize: fontSize.md, color: colors.text },
  body: { fontSize: fontSize.md, color: colors.text },
  italic: { fontStyle: "italic", fontWeight: "700" },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  recall: { borderLeftWidth: 4, borderLeftColor: colors.danger, paddingLeft: spacing.md, gap: spacing.xs, marginTop: spacing.sm },
  recallTitle: { fontSize: fontSize.md, fontWeight: "800", color: colors.danger },
  banner: { backgroundColor: colors.dangerLight, minHeight: TAP_TARGET, justifyContent: "center", paddingHorizontal: spacing.lg },
  bannerText: { color: colors.danger, fontWeight: "700", fontSize: fontSize.sm },
});
