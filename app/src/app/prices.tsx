import { Info } from "lucide-react-native";
import { useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { usePrices } from "@/api/hooks/ai";
import { useUpdateMe } from "@/api/hooks/me";
import { useShoppingList } from "@/api/hooks/shoppingList";
import { AiLabel, AppText, Button, Card, ErrorState, LoadingState, StatusChip, TextField, useToast } from "@/components/ui";
import { formatCents, formatCentsRange, timeAgo } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

/**
 * Price estimate for the shopping list (Akamai AI, cached 24 h per item and ZIP on the server). Items the U.S. Bureau
 * of Labor Statistics tracks use its latest average for the ZIP's region (cited); the rest are AI estimates.
 */
export default function PricesScreen() {
  const groupId = useRequiredGroupId();
  const { user } = useAuth();
  const hasZip = !!user?.zipCode;
  const prices = usePrices(groupId, { enabled: hasZip });
  const list = useShoppingList(groupId);

  const needsZip = !hasZip || (prices.error instanceof ApiError && prices.error.code === "ZIP_REQUIRED");

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <AiLabel text="AI price estimate" />
      <View style={styles.note}>
        <Info size={16} color={color.muted} />
        <AppText variant="caption" color="muted" style={styles.flex}>
          Staples use the latest U.S. Bureau of Labor Statistics average price for your region. Other items are AI
          estimates of typical supermarket prices. Real prices vary by store and brand.
        </AppText>
      </View>

      {needsZip ? <ZipPrompt /> : null}

      {!needsZip && prices.isPending ? (
        <View>
          <LoadingState />
          <AppText variant="caption" color="muted" center>
            Estimating prices. This can take up to a minute.
          </AppText>
        </View>
      ) : null}

      {!needsZip && prices.isError ? <ErrorState message={errorMessage(prices.error)} onRetry={() => void prices.refetch()} /> : null}

      {prices.data ? (
        <>
          <Card style={styles.totalCard}>
            <AppText variant="caption" weight="semi" color="muted">{`Estimated total · ZIP ${prices.data.zipCode}`}</AppText>
            <AppText variant="h1" accessibilityRole="header">
              {`About ${formatCents(prices.data.items.reduce((sum, p) => sum + (p.typicalCents ?? Math.round((p.lowCents + p.highCents) / 2)), 0))}`}
            </AppText>
            <AppText variant="caption" color="muted">
              {`Range ${formatCentsRange(prices.data.totalLowCents, prices.data.totalHighCents, true)} · ${prices.data.items.length} item${prices.data.items.length === 1 ? "" : "s"} priced, ${prices.data.items.filter((p) => p.basis === "regional_average").length} from BLS regional data`}
            </AppText>
            <Button label="Refresh" variant="ghost" size="sm" loading={prices.isFetching} onPress={() => void prices.refetch()} style={styles.start} />
          </Card>
          {prices.data.items.map((p) => (
            <Card key={p.itemId} style={styles.row}>
              <AppText variant="bodyL" weight="heavy">
                {`${p.name} · ~${formatCents(p.typicalCents ?? Math.round((p.lowCents + p.highCents) / 2))}`}
                {p.unit ? (
                  <AppText variant="caption" color="muted">{` ${p.unit}`}</AppText>
                ) : null}
              </AppText>
              <AppText variant="caption" color="muted">{`Usually ${formatCentsRange(p.lowCents, p.highCents)}`}</AppText>
              <View style={styles.meta}>
                {p.basis === "regional_average" ? <StatusChip label="BLS regional average" tone="ok" /> : <AiLabel text="AI estimate" />}
                {p.cached ? (
                  <AppText variant="caption" color="muted">{`from ${timeAgo(p.fetchedAt)}`}</AppText>
                ) : null}
              </View>
              {p.sources.map((s) => (
                <AppText
                  key={s}
                  variant="caption"
                  weight="semi"
                  color="primary"
                  style={styles.link}
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(s)}
                  numberOfLines={1}
                >
                  {s.startsWith("https://data.bls.gov/timeseries/") ? `Source: BLS average price series ${s.split("/").pop()}` : s}
                </AppText>
              ))}
            </Card>
          ))}
          {prices.data.missingItemIds.length > 0 ? (
            <AppText variant="caption" color="muted">
              {`No estimate for: ${prices.data.missingItemIds
                .map((id) => list.data?.find((r) => r.itemId === id)?.item.name ?? "an item")
                .join(", ")}`}
            </AppText>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function ZipPrompt() {
  const update = useUpdateMe();
  const { show: toast } = useToast();
  const [zip, setZip] = useState("");
  return (
    <Card style={styles.zip}>
      <AppText color="ink2">Add your ZIP code to estimate prices near you.</AppText>
      <TextField
        label="ZIP code"
        value={zip}
        onChangeText={(t) => setZip(t.replace(/\D/g, "").slice(0, 5))}
        keyboardType="number-pad"
        placeholder="64105"
      />
      <Button
        label="Save and estimate"
        fullWidth
        disabled={!/^\d{5}$/.test(zip)}
        loading={update.isPending}
        onPress={() => update.mutate({ zipCode: zip }, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.screenX, gap: space.md, paddingBottom: space.xxl * 2 },
  note: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  flex: { flex: 1 },
  start: { alignSelf: "flex-start" },
  totalCard: { gap: space.xs },
  row: { gap: space.xs },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  link: { textDecorationLine: "underline" },
  zip: { gap: space.md },
});
