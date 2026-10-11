import { useRouter } from "expo-router";
import { ChevronRight, TriangleAlert } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAlerts, useDismissRecall } from "@/api/hooks/alerts";
import { AppText, Button, Card, DashedEmpty, ErrorState, LoadingState, SectionLabel, StatusChip, useToast } from "@/components/ui";
import { expirationText, plural, shortDate } from "@/lib/format";
import { color, pressedOpacity, radius, size, space } from "@/theme";

import { ExpirationPill } from "./Badges";

/** Household tab → Alerts: expiring soon (tap → ItemDetail, "Find recipes") and possible recalls (Dismiss). */
export function AlertsSection({ groupId }: { groupId: string }) {
  const alerts = useAlerts(groupId);
  const dismiss = useDismissRecall(groupId);
  const router = useRouter();
  const { show: toast } = useToast();

  const count = (alerts.data?.expiring.length ?? 0) + (alerts.data?.recalls.length ?? 0);
  return (
    <View style={styles.gap}>
      <SectionLabel>{`Alerts${count ? ` (${count})` : ""}`}</SectionLabel>
      {alerts.isPending ? (
        <LoadingState />
      ) : alerts.isError ? (
        <ErrorState message={errorMessage(alerts.error)} onRetry={() => void alerts.refetch()} />
      ) : count === 0 ? (
        <DashedEmpty>Nothing expiring and no recalls.</DashedEmpty>
      ) : (
        <>
          {alerts.data.expiring.length > 0 ? (
            <Card style={styles.gap}>
              <View style={styles.rowBetween}>
                <AppText variant="bodyL" weight="heavy">
                  Expiring soon
                </AppText>
                <Button label="Find recipes" variant="ghost" size="sm" onPress={() => router.push("/recipes")} />
              </View>
              {alerts.data.expiring.map((c) => (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [styles.item, pressed && { opacity: pressedOpacity }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.item.name}. ${expirationText(c)}. Open details`}
                  onPress={() => router.push(`/item-detail/${c.id}`)}
                >
                  <AppText weight="semi" style={styles.flex}>
                    {c.item.name}
                  </AppText>
                  <ExpirationPill expiresAt={c.expiresAt} source={c.expirationSource} />
                </Pressable>
              ))}
            </Card>
          ) : null}
          {alerts.data.recalls.map((r) => (
            <Card key={r.id} style={styles.gap} accessibilityRole="alert">
              <StatusChip tone="danger" label="Possible recall" icon={TriangleAlert} />
              <AppText>
                This{" "}
                <AppText weight="heavy" style={styles.italic}>
                  may
                </AppText>{" "}
                match your {r.cabinetItem.brand ? `${r.cabinetItem.brand} ` : ""}
                {r.cabinetItem.name}. Check the package.
              </AppText>
              <AppText variant="caption" color="muted">
                {r.recall.productDescription}
              </AppText>
              {r.recall.reason ? <AppText>{`Reason: ${r.recall.reason}`}</AppText> : null}
              <AppText variant="caption" color="muted">
                {[r.recall.classification, r.recall.firm, r.recall.reportDate ? shortDate(r.recall.reportDate.slice(0, 10)) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </AppText>
              <View style={styles.row}>
                {r.recall.url ? (
                  <Button label="View FDA notice" variant="ghost" size="sm" onPress={() => void Linking.openURL(r.recall.url!)} />
                ) : null}
                <Button
                  label="Dismiss"
                  variant="secondary"
                  size="sm"
                  accessibilityLabel={`Dismiss recall alert for ${r.cabinetItem.name}`}
                  onPress={() => dismiss.mutate(r.id, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
                />
              </View>
            </Card>
          ))}
        </>
      )}
    </View>
  );
}

/** Count for the Household tab badge. */
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
    <Pressable
      style={({ pressed }) => [styles.banner, pressed && { opacity: pressedOpacity }]}
      accessibilityRole="button"
      accessibilityLabel={`${plural(n, "possible recall")} for items in your cabinet. Open alerts`}
      onPress={() => router.push("/group")}
    >
      <TriangleAlert size={18} color={color.dangerFg} />
      <AppText variant="bodyS" weight="bold" color="dangerFg" style={styles.flex}>
        {`${plural(n, "possible recall")} for items in your cabinet`}
      </AppText>
      <ChevronRight size={18} color={color.dangerFg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
  flex: { flex: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: size.hit },
  italic: { fontStyle: "italic" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: color.dangerBg,
    minHeight: size.hit,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
  },
});
