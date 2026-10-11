import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet, useUpdateCabinetItem } from "@/api/hooks/cabinet";
import { useHouseholdAllergens, useProductLookup } from "@/api/hooks/products";
import { pickAndUploadImage } from "@/api/hooks/uploads";
import { ExpirationPill, StockChip } from "@/components/Badges";
import { DateField } from "@/components/DateField";
import { ProductFactsCard } from "@/components/ProductFactsCard";
import { AppText, Button, Card, DashedEmpty, ErrorState, LoadingState, SectionLabel, ToggleChip, useToast } from "@/components/ui";
import { useCabinetActions } from "@/components/useCabinetActions";
import { LOCATION_LABEL, LOCATIONS } from "@/features/cabinet/CabinetView";
import { expirationText, labelize } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color, radius, space } from "@/theme";

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
  const lookup = useProductLookup();
  const household = useHouseholdAllergens(groupId);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  if (cabinet.isPending) return <LoadingState />;
  const row = cabinet.data?.find((r) => r.id === id);
  if (cabinet.isError || !row) {
    return (
      <View style={styles.container}>
        {cabinet.isError ? (
          <ErrorState message={errorMessage(cabinet.error)} onRetry={() => void cabinet.refetch()} />
        ) : (
          <DashedEmpty>This item is no longer in the cabinet.</DashedEmpty>
        )}
      </View>
    );
  }

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

  const low = row.status === "running_low";

  return (
    <ScrollView contentContainerStyle={styles.container} testID="screen-item-detail">
      <View style={styles.gapSm}>
        <AppText variant="caption" weight="semi" color="muted">
          {row.item.category ? labelize(row.item.category) : null}
        </AppText>
        <AppText variant="h1" accessibilityRole="header">
          {row.item.name}
        </AppText>
        <View style={styles.chips}>
          <StockChip status={row.status} />
          <ExpirationPill expiresAt={row.expiresAt} source={row.expirationSource} />
        </View>
      </View>

      {row.product ? (
        <Card style={styles.product}>
          {row.product.imageUrl ? (
            <Image source={{ uri: row.product.imageUrl }} style={styles.image} contentFit="contain" accessibilityLabel={row.product.name} />
          ) : null}
          <View style={styles.flex}>
            {row.product.brand ? (
              <AppText variant="caption" weight="semi" color="muted">
                {row.product.brand}
              </AppText>
            ) : null}
            <AppText variant="bodyL" weight="heavy">
              {row.product.name}
            </AppText>
            <AppText variant="caption" color="muted">
              From a scan
            </AppText>
          </View>
        </Card>
      ) : null}

      <SectionLabel>Expiration</SectionLabel>
      <Card style={styles.gapSm}>
        <AppText>{expirationText(row)}</AppText>
        <DateField
          value={row.expiresAt}
          disabled={update.isPending}
          onChange={(ymd) => update.mutate({ id: row.id, expiresAt: ymd }, { onSuccess: () => toast("Date saved"), onError })}
        />
      </Card>

      <SectionLabel>Shelf life, price & allergens</SectionLabel>
      {lookup.data ? (
        <ProductFactsCard lookup={lookup.data} household={household} />
      ) : (
        <Card style={styles.gapSm}>
          <AppText variant="caption" color="muted">
            {lookup.isPending
              ? "Checking USDA FoodKeeper, BLS prices and Open Food Facts… this can take up to a minute."
              : "An AI agent looks this up in USDA, BLS and Open Food Facts data and cites every source. It also fills in an estimated expiration date."}
          </AppText>
          <Button
            label="Look up details"
            variant="secondary"
            size="sm"
            loading={lookup.isPending}
            style={styles.start}
            onPress={() =>
              lookup.mutate(
                {
                  name: row.product ? [row.product.brand, row.product.name].filter(Boolean).join(" ").slice(0, 120) : row.item.name,
                  groupId,
                  cabinetItemId: row.id,
                },
                { onError },
              )
            }
          />
        </Card>
      )}

      <SectionLabel>Details</SectionLabel>
      <Card style={styles.gapSm}>
        <AppText variant="caption" weight="bold" color="ink2">
          Location
        </AppText>
        <View style={styles.chips}>
          {LOCATIONS.map((l) => (
            <ToggleChip
              key={l}
              label={LOCATION_LABEL[l]}
              selected={(row.location ?? "other") === l}
              onPress={() => update.mutate({ id: row.id, location: l }, { onError })}
            />
          ))}
        </View>
        {row.quantityText ? <AppText>{`Quantity: ${row.quantityText}`}</AppText> : null}
        <AppText>{`Purchased: ${row.purchasedAt ? new Date(row.purchasedAt).toLocaleDateString() : "not recorded"}`}</AppText>
        {row.photoUrl ? <Image source={{ uri: row.photoUrl }} style={styles.photo} accessibilityLabel={`Photo of ${row.item.name}`} /> : null}
        <Button
          label={row.photoUrl ? "Change photo" : "Add photo"}
          variant="ghost"
          size="sm"
          loading={uploading}
          onPress={addPhoto}
          style={styles.start}
        />
      </Card>

      <SectionLabel>Actions</SectionLabel>
      <View style={styles.row}>
        <Button
          label={low ? "Back in stock" : "Running low"}
          variant="secondary"
          flex
          onPress={() => (low ? actions.backInStock(row) : actions.markLow(row))}
        />
        <Button
          label="Ran out"
          variant="danger-secondary"
          flex
          onPress={() => {
            actions.ranOut(row);
            router.back();
          }}
        />
      </View>
      <Button label="Remove from cabinet" variant="danger-secondary" fullWidth onPress={() => void actions.remove(row)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.screenX, gap: space.md, paddingBottom: 40 },
  gapSm: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  row: { flexDirection: "row", gap: space.sm },
  product: { flexDirection: "row", gap: space.md },
  image: { width: 64, height: 64, borderRadius: radius.control, backgroundColor: color.bg },
  photo: { width: "100%", height: 180, borderRadius: radius.control },
  flex: { flex: 1 },
  start: { alignSelf: "flex-start" },
});
