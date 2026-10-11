import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet, useUpdateCabinetItem } from "@/api/hooks/cabinet";
import { ExpirationPill } from "@/components/Badges";
import { DateField } from "@/components/DateField";
import { AppText, Button, Card, ErrorState, LoadingState, useToast } from "@/components/ui";
import { expirationText } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { space } from "@/theme";

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
  if (cabinet.isError)
    return (
      <View style={styles.container}>
        <ErrorState message={errorMessage(cabinet.error)} onRetry={() => void cabinet.refetch()} />
      </View>
    );
  const rows = cabinet.data.filter((r) => ids.has(r.itemId));

  return (
    <ScrollView contentContainerStyle={styles.container} testID="screen-expiration-check">
      <AppText variant="h1" accessibilityRole="header">
        Check expiration dates?
      </AppText>
      <AppText color="ink2">Estimated from typical shelf life. Fix any that are wrong, or skip to keep the estimates.</AppText>
      {rows.map((r) => (
        <Card key={r.id} style={styles.card}>
          <View style={styles.top}>
            <AppText variant="bodyL" weight="heavy" style={styles.flex}>
              {r.item.name}
            </AppText>
            <ExpirationPill expiresAt={r.expiresAt} source={r.expirationSource} />
          </View>
          <AppText variant="caption" color="muted">
            {expirationText(r)}
          </AppText>
          <DateField
            value={r.expiresAt}
            onChange={(ymd) => update.mutate({ id: r.id, expiresAt: ymd }, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
          />
        </Card>
      ))}
      <View style={styles.footer}>
        <Button label="Done" variant="dark" size="lg" fullWidth onPress={() => router.back()} />
        <Button label="Skip" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.screenX, gap: space.md },
  card: { gap: space.sm },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  flex: { flex: 1 },
  footer: { gap: space.sm, marginTop: space.md },
});
