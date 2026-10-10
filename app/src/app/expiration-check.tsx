import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet, useUpdateCabinetItem } from "@/api/hooks/cabinet";
import { DateField } from "@/components/DateField";
import { ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/ui";
import { Button, Card } from "@/components/ui";
import { expirationText } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { colors, fontSize, spacing } from "@/theme";

/** After "Finish trip": the items just added, with their estimated dates, each editable. Skipping keeps the estimates. */
export default function ExpirationCheckScreen() {
  const { itemIds = "" } = useLocalSearchParams<{ itemIds?: string }>();
  const groupId = useRequiredGroupId();
  const cabinet = useCabinet(groupId);
  const update = useUpdateCabinetItem(groupId);
  const router = useRouter();
  const { show: toast } = useToast();
  const ids = useMemo(() => new Set(itemIds.split(",").filter(Boolean)), [itemIds]);

  if (cabinet.isPending) return <LoadingState />;
  if (cabinet.isError) return <ErrorState error={cabinet.error} onRetry={() => cabinet.refetch()} />;
  const rows = cabinet.data.filter((r) => ids.has(r.itemId));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Check expiration dates?</Text>
      <Text style={styles.muted}>Estimated from typical shelf life. Fix any that are wrong, or skip to keep the estimates.</Text>
      {rows.map((r) => (
        <Card key={r.id}>
          <Text style={styles.name}>{r.item.name}</Text>
          <Text style={styles.muted}>{expirationText(r)}</Text>
          <DateField
            value={r.expiresAt}
            onChange={(ymd) => update.mutate({ id: r.id, expiresAt: ymd }, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
          />
        </Card>
      ))}
      <View style={styles.footer}>
        <Button title="Done" onPress={() => router.back()} />
        <Button title="Skip" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: "800", color: colors.text },
  name: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  footer: { gap: spacing.sm, marginTop: spacing.md },
});
