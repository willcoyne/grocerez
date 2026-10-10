import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet, useUpdateCabinetItem } from "@/api/hooks/cabinet";
import { pickAndUploadImage } from "@/api/hooks/uploads";
import { ExpirationPill, StatusChip } from "@/components/Badges";
import { DateField } from "@/components/DateField";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/ui";
import { Button, Card, Chip, SectionHeader } from "@/components/ui";
import { useCabinetActions } from "@/components/useCabinetActions";
import { expirationText, labelize } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { colors, fontSize, radius, spacing } from "@/theme";

const LOCATIONS = ["fridge", "freezer", "pantry", "other"] as const;

/** Everything about a cabinet item: product, location, purchase date, expiration (editable), photo, and actions. */
export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = useRequiredGroupId();
  const cabinet = useCabinet(groupId);
  const update = useUpdateCabinetItem(groupId);
  const actions = useCabinetActions(groupId);
  const router = useRouter();
  const { show: toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  if (cabinet.isPending) return <LoadingState />;
  if (cabinet.isError) return <ErrorState error={cabinet.error} onRetry={() => cabinet.refetch()} />;
  const row = cabinet.data.find((r) => r.id === id);
  if (!row) return <EmptyState title="This item is no longer in the cabinet" />;

  async function addPhoto() {
    setUploading(true);
    try {
      const key = await pickAndUploadImage("item-photo");
      if (key) update.mutate({ id: row!.id, photoKey: key }, { onError });
    } catch (e) {
      onError(e);
    } finally {
      setUploading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {row.item.name}
      </Text>
      <View style={styles.row}>
        <ExpirationPill expiresAt={row.expiresAt} source={row.expirationSource} />
        <StatusChip status={row.status} />
      </View>

      {row.product ? (
        <Card style={styles.product}>
          {row.product.imageUrl ? (
            <Image source={{ uri: row.product.imageUrl }} style={styles.image} contentFit="contain" accessibilityLabel={row.product.name} />
          ) : null}
          <View style={styles.flex}>
            {row.product.brand ? <Text style={styles.muted}>{row.product.brand}</Text> : null}
            <Text style={styles.name}>{row.product.name}</Text>
            <Text style={styles.muted}>From a scan</Text>
          </View>
        </Card>
      ) : null}

      <SectionHeader title="Expiration" />
      <Card>
        <Text style={styles.body}>{expirationText(row)}</Text>
        <DateField
          value={row.expiresAt}
          disabled={update.isPending}
          onChange={(ymd) => update.mutate({ id: row.id, expiresAt: ymd }, { onSuccess: () => toast("Date saved"), onError })}
        />
      </Card>

      <SectionHeader title="Details" />
      <Card>
        <Text style={styles.label}>Location</Text>
        <View style={styles.row}>
          {LOCATIONS.map((l) => (
            <Chip
              key={l}
              label={labelize(l)}
              selected={(row.location ?? "other") === l}
              onPress={() => update.mutate({ id: row.id, location: l }, { onError })}
            />
          ))}
        </View>
        {row.quantityText ? <Text style={styles.body}>Quantity: {row.quantityText}</Text> : null}
        <Text style={styles.body}>
          Purchased: {row.purchasedAt ? new Date(row.purchasedAt).toLocaleDateString() : "not recorded"}
        </Text>
        {row.photoUrl ? <Image source={{ uri: row.photoUrl }} style={styles.photo} accessibilityLabel={`Photo of ${row.item.name}`} /> : null}
        <Button title={row.photoUrl ? "Change photo" : "Add photo"} variant="ghost" compact loading={uploading} onPress={addPhoto} />
      </Card>

      <SectionHeader title="Actions" />
      <View style={styles.actions}>
        {row.status === "running_low" ? (
          <Button title="Back in stock" variant="secondary" onPress={() => actions.backInStock(row)} />
        ) : (
          <Button title="Running low" variant="secondary" onPress={() => actions.markLow(row)} />
        )}
        <Button
          title="Ran out"
          variant="secondary"
          onPress={() => {
            actions.ranOut(row);
            router.back();
          }}
        />
        <Button
          title="Remove"
          variant="danger"
          onPress={() => void actions.remove(row)}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  title: { fontSize: fontSize.xxl, fontWeight: "800", color: colors.text },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  product: { flexDirection: "row", gap: spacing.md },
  image: { width: 64, height: 64, borderRadius: radius.md },
  photo: { width: "100%", height: 180, borderRadius: radius.md },
  flex: { flex: 1 },
  name: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },
  label: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },
  body: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  actions: { gap: spacing.sm },
});
