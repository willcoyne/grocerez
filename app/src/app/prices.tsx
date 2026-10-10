import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { usePrices } from "@/api/hooks/ai";
import { useUpdateMe } from "@/api/hooks/me";
import { useShoppingList } from "@/api/hooks/shoppingList";
import { LoadingState } from "@/components/States";
import { useToast } from "@/components/Toast";
import { AiLabel, Button, Card, Input } from "@/components/ui";
import { formatCentsRange, timeAgo } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

/** AI price estimate for the shopping list (Claude + web search, cached 24 h on the server). */
export default function PricesScreen() {
  const groupId = useRequiredGroupId();
  const { user } = useAuth();
  const hasZip = !!user?.zipCode;
  const prices = usePrices(groupId, { enabled: hasZip });
  const list = useShoppingList(groupId);

  const needsZip = !hasZip || (prices.error instanceof ApiError && prices.error.code === "ZIP_REQUIRED");

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <AiLabel text="AI estimate from web search" />
      <Text style={styles.muted}>
        ⓘ Prices are estimated by AI from web search results near your ZIP code. They may be off; check the store.
      </Text>

      {needsZip ? <ZipPrompt /> : null}

      {!needsZip && prices.isPending ? <LoadingState message="Estimating prices… (up to 30 seconds)" /> : null}

      {!needsZip && prices.isError ? (
        <Card>
          <Text style={styles.error} accessibilityRole="alert">
            {errorMessage(prices.error)}
          </Text>
          <Button title="Try again" variant="secondary" onPress={() => void prices.refetch()} />
        </Card>
      ) : null}

      {prices.data ? (
        <>
          <Card>
            <Text style={styles.muted}>Estimated total · ZIP {prices.data.zipCode}</Text>
            <Text style={styles.total} accessibilityRole="header">
              {formatCentsRange(prices.data.totalLowCents, prices.data.totalHighCents, true)}
            </Text>
            <Button title="Refresh" variant="ghost" compact loading={prices.isFetching} onPress={() => void prices.refetch()} />
          </Card>
          {prices.data.items.map((p) => (
            <View key={p.itemId} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.name}>
                  {p.name} · {formatCentsRange(p.lowCents, p.highCents)}
                  {p.unit ? <Text style={styles.muted}> {p.unit}</Text> : null}
                </Text>
                <Text style={styles.muted}>
                  ✨ estimate{p.cached ? ` · from ${timeAgo(p.fetchedAt)}` : ""}
                </Text>
                {p.sources.map((s) => (
                  <Text key={s} style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(s)} numberOfLines={1}>
                    {s}
                  </Text>
                ))}
              </View>
            </View>
          ))}
          {prices.data.missingItemIds.length > 0 ? (
            <Text style={styles.muted}>
              No estimate for:{" "}
              {prices.data.missingItemIds
                .map((id) => list.data?.find((r) => r.itemId === id)?.item.name ?? "an item")
                .join(", ")}
            </Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function ZipPrompt() {
  const update = useUpdateMe();
  const toast = useToast();
  const [zip, setZip] = useState("");
  return (
    <Card>
      <Text style={styles.body}>Add your ZIP code to estimate prices near you.</Text>
      <Input
        label="ZIP code"
        value={zip}
        onChangeText={(t) => setZip(t.replace(/\D/g, "").slice(0, 5))}
        keyboardType="number-pad"
        maxLength={5}
      />
      <Button
        title="Save and estimate"
        disabled={!/^\d{5}$/.test(zip)}
        loading={update.isPending}
        onPress={() => update.mutate({ zipCode: zip }, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: "row", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  total: { fontSize: fontSize.xxl, fontWeight: "800", color: colors.text },
  name: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  body: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "400" },
  error: { fontSize: fontSize.md, color: colors.danger },
  link: { fontSize: fontSize.xs, color: colors.primary, textDecorationLine: "underline" },
});
