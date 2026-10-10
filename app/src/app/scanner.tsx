import type { Product, ScanBody } from "@contracts/products";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAddCabinetItem } from "@/api/hooks/cabinet";
import { useHouseholdAllergens, useScanProduct } from "@/api/hooks/products";
import { useAddListItem, useCheckItem } from "@/api/hooks/shoppingList";
import { ItemPicker } from "@/components/ItemPicker";
import { conflicts, ProductCard } from "@/components/ProductCard";
import { useToast } from "@/components/Toast";
import { Button, Card, Input } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { labelize } from "@/lib/format";
import { NOT_FOUND, scanErrorMessage, scanRequestFor } from "@/lib/scan";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { colors, fontSize, radius, spacing } from "@/theme";

type Mode = "lookup" | "match-list-item" | "add-to-cabinet";

/** Camera QR/barcode scanner (SmartLabel or UPC) → product details. Modes: lookup, match-list-item, add-to-cabinet. */
export default function ScannerScreen() {
  const params = useLocalSearchParams<{ mode?: string; listItemId?: string }>();
  const mode: Mode = params.mode === "match-list-item" || params.mode === "add-to-cabinet" ? params.mode : "lookup";
  const groupId = useRequiredGroupId();
  const router = useRouter();
  const toast = useToast();
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

  return (
    <View style={styles.flex}>
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
          <Text style={styles.hint}>
            {scan.isPending ? "Looking it up…" : "Scan the SmartLabel QR or the barcode"}
          </Text>
          {mode === "add-to-cabinet" && addedCount > 0 ? <Text style={styles.hint}>{addedCount} added</Text> : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.permission}>
          <Text style={styles.title}>Camera access</Text>
          <Text style={styles.body}>GrocerEZ uses the camera to scan SmartLabel QR codes and barcodes.</Text>
          {permission && !permission.canAskAgain ? (
            <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button title="Allow camera" onPress={() => void requestPermission()} />
          )}
          <Text style={styles.body}>Or type the barcode digits:</Text>
          <Input
            label="Barcode"
            value={manual}
            onChangeText={(t) => setManual(t.replace(/\D/g, ""))}
            keyboardType="number-pad"
            maxLength={14}
          />
          <Button
            title="Look up"
            variant="secondary"
            loading={scan.isPending}
            disabled={manual.length < 8}
            onPress={() => {
              const req = scanRequestFor("ean13", manual);
              if ("error" in req) setMessage(req.error);
              else lookup(req.body);
            }}
          />
        </ScrollView>
      )}

      {message || product ? (
        <View style={styles.sheetWrap}>
          <Card style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              {message ? <Text style={styles.message} accessibilityRole="alert">{message}</Text> : null}
              {notFound ? <Button title="Add manually" variant="secondary" onPress={() => setPicking(true)} /> : null}
              {product ? (
                <>
                  <ProductCard product={product} household={household} />
                  {mode === "match-list-item" ? (
                    <Button title="Check off with this product" loading={check.isPending} onPress={() => void checkOff(product)} />
                  ) : (
                    <View style={styles.row}>
                      <Button
                        title="Add to cabinet"
                        style={styles.flex}
                        loading={addCabinet.isPending}
                        onPress={() =>
                          addCabinet.mutate({ itemId: product.itemId }, { onSuccess: () => toast(`${product.item.name} added to cabinet`), onError })
                        }
                      />
                      <Button
                        title="Add to list"
                        variant="secondary"
                        style={styles.flex}
                        loading={addList.isPending}
                        onPress={() =>
                          addList.mutate({ itemId: product.itemId }, { onSuccess: () => toast(`${product.item.name} added to list`), onError })
                        }
                      />
                    </View>
                  )}
                </>
              ) : null}
              <Button
                title="Scan again"
                variant="ghost"
                onPress={() => {
                  setProduct(null);
                  setMessage(null);
                  setNotFound(false);
                }}
              />
            </ScrollView>
          </Card>
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
            addCabinet.mutate({ itemId: item.id }, { onSuccess: () => toast(`${item.name} added to cabinet`), onError });
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
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  frame: { width: 260, height: 180, borderWidth: 3, borderColor: "#FFFFFF", borderRadius: radius.lg },
  hint: { color: "#FFFFFF", fontSize: fontSize.md, fontWeight: "700", backgroundColor: colors.overlay, padding: spacing.sm, borderRadius: radius.sm },
  permission: { padding: spacing.xl, gap: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: "800", color: colors.text },
  body: { fontSize: fontSize.md, color: colors.textMuted },
  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "75%" },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  sheetContent: { gap: spacing.md, paddingBottom: spacing.xl },
  message: { fontSize: fontSize.md, color: colors.danger, fontWeight: "600" },
  row: { flexDirection: "row", gap: spacing.sm },
});
