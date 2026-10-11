import type { Product, ScanBody } from "@contracts/products";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAddCabinetItem } from "@/api/hooks/cabinet";
import { useHouseholdAllergens, useScanProduct } from "@/api/hooks/products";
import { useAddListItem, useCheckItem } from "@/api/hooks/shoppingList";
import { ItemPicker } from "@/components/ItemPicker";
import { conflicts, ProductCard } from "@/components/ProductCard";
import { AppText, Button, InlineAdd, useToast } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { labelize } from "@/lib/format";
import { BAD_BARCODE, NOT_FOUND, scanErrorMessage, scanRequestFor } from "@/lib/scan";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color, radius, space } from "@/theme";

type Mode = "lookup" | "match-list-item" | "add-to-cabinet";

/** Camera QR/barcode scanner (SmartLabel or UPC) → product details. Modes: lookup, match-list-item, add-to-cabinet. */
export default function ScannerScreen() {
  const params = useLocalSearchParams<{ mode?: string; listItemId?: string }>();
  const mode: Mode = params.mode === "match-list-item" || params.mode === "add-to-cabinet" ? params.mode : "lookup";
  const groupId = useRequiredGroupId();
  const router = useRouter();
  const { show: toast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const scan = useScanProduct();
  const household = useHouseholdAllergens(groupId);
  const addCabinet = useAddCabinetItem(groupId);
  const addList = useAddListItem(groupId);
  const check = useCheckItem(groupId);

  const [product, setProduct] = useState<Product | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState("");
  const [addedCount, setAddedCount] = useState(0);
  const last = useRef<{ data: string; at: number } | null>(null);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  function lookup(body: ScanBody) {
    setMessage(null);
    setNotFound(false);
    scan.mutate(body, {
      onSuccess: (p) => {
        if (mode === "add-to-cabinet") {
          addCabinet.mutate(
            { itemId: p.itemId },
            {
              onSuccess: () => {
                setAddedCount((n) => n + 1);
                toast(`${p.brand ? `${p.brand} ` : ""}${p.name} added`);
              },
              onError,
            },
          );
          return;
        }
        setProduct(p);
      },
      onError: (e) => {
        const msg = scanErrorMessage(e, body);
        setNotFound(msg === NOT_FOUND);
        setMessage(msg ?? errorMessage(e));
      },
    });
  }

  function onScanned(result: BarcodeScanningResult) {
    if (scan.isPending || product) return; // paused while a request is in flight or a result is shown
    const now = Date.now();
    if (last.current && last.current.data === result.data && now - last.current.at < 2000) return; // ignore repeats for 2 s
    last.current = { data: result.data, at: now };
    const req = scanRequestFor(result.type, result.data);
    if ("error" in req) return setMessage(req.error);
    lookup(req.body);
  }

  async function checkOff(p: Product) {
    const hits = conflicts(p, household);
    if (hits.length > 0) {
      const text = hits.map((h) => `${labelize(h.allergen)} (${h.names.join(", ")})`).join(", ");
      if (!(await confirm("Allergen warning", `This product contains or may contain ${text}. Check it off anyway?`, "Check off"))) return;
    }
    if (!params.listItemId) return;
    check.mutate(
      { id: params.listItemId, checked: true, scannedProductId: p.id },
      { onSuccess: () => router.back(), onError },
    );
  }

  const granted = permission?.granted;
  const reset = () => {
    setProduct(null);
    setMessage(null);
    setNotFound(false);
  };

  return (
    <View style={styles.flex} testID="screen-scanner">
      {granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "upc_a", "upc_e", "ean8"] }}
          onBarcodeScanned={product ? undefined : onScanned}
        />
      ) : null}

      {granted ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.frame} />
          <View style={styles.hint}>
            <AppText variant="bodyS" weight="bold" color="onPrimary" center>
              {scan.isPending ? "Looking it up…" : "Scan the SmartLabel QR or the barcode"}
            </AppText>
          </View>
          {mode === "add-to-cabinet" && addedCount > 0 ? (
            <View style={styles.hint}>
              <AppText variant="bodyS" weight="bold" color="onPrimary">{`${addedCount} added`}</AppText>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.permission}>
          <AppText variant="h1" accessibilityRole="header">
            Camera access
          </AppText>
          <AppText color="ink2">GrocerEZ uses the camera to scan SmartLabel QR codes and barcodes.</AppText>
          {permission && !permission.canAskAgain ? (
            <Button label="Open Settings" size="lg" fullWidth onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Allow camera" size="lg" fullWidth onPress={() => void requestPermission()} />
          )}
          <InlineAdd
            label="Or type the barcode digits"
            value={manual}
            onChangeText={(t) => setManual(t.replace(/\D/g, ""))}
            keyboardType="number-pad"
            placeholder="e.g. 016000275287"
            buttonLabel="Look up"
            busy={scan.isPending}
            onSubmit={() => {
              if (manual.length < 8) return setMessage(BAD_BARCODE);
              const req = scanRequestFor("ean13", manual);
              if ("error" in req) setMessage(req.error);
              else lookup(req.body);
            }}
          />
        </ScrollView>
      )}

      {message || product ? (
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {message ? (
              <AppText weight="bold" color="dangerFg" accessibilityRole="alert">
                {message}
              </AppText>
            ) : null}
            {notFound ? <Button label="Add manually" variant="secondary" fullWidth onPress={() => setPicking(true)} /> : null}
            {product ? (
              <>
                <ProductCard product={product} household={household} />
                {mode === "match-list-item" ? (
                  <Button
                    label="Check off with this product"
                    size="lg"
                    fullWidth
                    loading={check.isPending}
                    onPress={() => void checkOff(product)}
                  />
                ) : (
                  <View style={styles.row}>
                    <Button
                      label="Add to cabinet"
                      flex
                      loading={addCabinet.isPending}
                      onPress={() =>
                        addCabinet.mutate(
                          { itemId: product.itemId },
                          { onSuccess: () => toast(`${product.item.name} is in the cabinet`), onError },
                        )
                      }
                    />
                    <Button
                      label="Add to list"
                      variant="secondary"
                      flex
                      loading={addList.isPending}
                      onPress={() =>
                        addList.mutate(
                          { itemId: product.itemId },
                          { onSuccess: () => toast(`Added ${product.item.name} to the shopping list`), onError },
                        )
                      }
                    />
                  </View>
                )}
              </>
            ) : null}
            <Button label="Scan again" variant="ghost" fullWidth onPress={reset} />
          </ScrollView>
        </View>
      ) : null}

      <ItemPicker
        visible={picking}
        title="Add manually"
        onClose={() => setPicking(false)}
        onPick={(item) => {
          if (mode === "match-list-item" && params.listItemId) {
            check.mutate({ id: params.listItemId, checked: true }, { onSuccess: () => router.back(), onError });
          } else if (mode === "add-to-cabinet" || mode === "lookup") {
            addCabinet.mutate({ itemId: item.id }, { onSuccess: () => toast(`${item.name} is in the cabinet`), onError });
          }
          setMessage(null);
          setNotFound(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: space.lg },
  frame: { width: 260, height: 180, borderWidth: 3, borderColor: color.onPrimary, borderRadius: radius.cardLg },
  hint: { backgroundColor: color.overlay, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.control },
  permission: { padding: space.screenX, paddingTop: 40, gap: space.lg },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "75%",
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.cardLg,
    borderTopRightRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: color.border,
  },
  sheetContent: { padding: space.screenX, gap: space.md, paddingBottom: 40 },
  row: { flexDirection: "row", gap: space.sm },
});
