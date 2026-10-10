import { Info } from "lucide-react-native";
import { useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { usePrices } from "@/api/hooks/ai";
import { useUpdateMe } from "@/api/hooks/me";
import { useShoppingList } from "@/api/hooks/shoppingList";
import { AiLabel, AppText, Button, Card, ErrorState, LoadingState, TextField, useToast } from "@/components/ui";
import { formatCentsRange, timeAgo } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

/** AI price estimate for the shopping list (Claude + web search, cached 24 h on the server). */
export default function PricesScreen() {
  const groupId = useRequiredGroupId();
  const { user } = useAuth();
  const hasZip = !!user?.zipCode;
  const prices = usePrices(groupId, { enabled: hasZip });
  const list = useShoppingList(groupId);

  const needsZip = !hasZip || (prices.error instanceof ApiError && prices.error.code === "ZIP_REQUIRED");

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <AiLabel text="AI estimate from web search" />
      <View style={styles.note}>
        <Info size={16} color={color.muted} />
        <AppText variant="caption" color="muted" style={styles.flex}>
          Prices are estimated by AI from web search results near your ZIP code. They may be off; check the store.
        </AppText>
      </View>

      {needsZip ? <ZipPrompt /> : null}

      {!needsZip && prices.isPending ? (
        <View>
          <LoadingState />
          <AppText variant="caption" color="muted" center>
            Estimating prices. This can take up to 30 seconds.
          </AppText>
        </View>
      ) : null}

      {!needsZip && prices.isError ? <ErrorState message={errorMessage(prices.error)} onRetry={() => void prices.refetch()} /> : null}

      {prices.data ? (
        <>
          <Card style={styles.totalCard}>
            <AppText variant="caption" weight="semi" color="muted">{`Estimated total · ZIP ${prices.data.zipCode}`}</AppText>
            <AppText variant="h1" accessibilityRole="header">
              {formatCentsRange(prices.data.totalLowCents, prices.data.totalHighCents, true)}
            </AppText>
            <Button label="Refresh" variant="ghost" size="sm" loading={prices.isFetching} onPress={() => void prices.refetch()} style={styles.start} />
          </Card>
          {prices.data.items.map((p) => (
            <Card key={p.itemId} style={styles.row}>
              <AppText variant="bodyL" weight="heavy">
                {`${p.name} · ${formatCentsRange(p.lowCents, p.highCents)}`}
                {p.unit ? (
                  <AppText variant="caption" color="muted">{` ${p.unit}`}</AppText>
                ) : null}
              </AppText>
              <View style={styles.meta}>
                <AiLabel text="Estimate" />
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
                  {s}
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
