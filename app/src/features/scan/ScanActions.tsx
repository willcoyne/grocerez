/**
 * What you can do with a scanned product while shopping. All writes go through the shared TanStack hooks; the server
 * decides whether a product fits a list row (409 PRODUCT_ITEM_MISMATCH) — the app only reacts to its answer.
 */
import type { Product } from "@contracts/products";
import type { ShoppingListItem } from "@contracts/shoppingList";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { useAddListItem, useCheckItem } from "@/api/hooks/shoppingList";
import { AppText } from "@/components/ui";

import { fixed, useThemeUi } from "./scanTheme";
import { ScanButton } from "./ui";

function Note({ text, tone = "info", testID }: { text: string; tone?: "info" | "error" | "ok"; testID?: string }) {
  const ui = useThemeUi();
  const bg = tone === "error" ? fixed.dangerTint : tone === "ok" ? fixed.okBg : "transparent";
  const fg = tone === "error" ? fixed.dangerInk : tone === "ok" ? fixed.okInk : ui.text;
  return (
    <View style={[styles.note, { backgroundColor: bg }]}>
      <AppText variant="bodyS" weight="bold" style={{ color: fg }} accessibilityRole={tone === "error" ? "alert" : "text"} testID={testID}>
        {text}
      </AppText>
    </View>
  );
}

/** The list row a product counts for: an unchecked row of the same catalog item first, else a checked one. */
export function listRowFor(list: ShoppingListItem[], product: Pick<Product, "itemId">): ShoppingListItem | null {
  return list.find((r) => r.itemId === product.itemId && !r.checked) ?? list.find((r) => r.itemId === product.itemId) ?? null;
}

export function ShoppingActions({
  groupId,
  list,
  product,
  warnMe,
  onAddedToCart,
  onDone,
}: {
  groupId: string;
  list: ShoppingListItem[];
  product: Product;
  /** The signed-in user is allergic to something on the label (label reads "anyway"). */
  warnMe: boolean;
  onAddedToCart?: (listItemId: string, product: Product) => void;
  /** Success: back to scanning, with a confirmation line. */
  onDone: (notice: string) => void;
}) {
  const check = useCheckItem(groupId);
  const add = useAddListItem(groupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatchRow, setMismatchRow] = useState<string | null>(null);
  const row = listRowFor(list, product);
  const name = product.item.name;

  async function put(withLabel: boolean) {
    setBusy(true);
    setError(null);
    let rowId = mismatchRow ?? row?.id ?? null;
    try {
      if (!rowId) rowId = (await add.mutateAsync({ itemId: product.itemId })).id;
      await check.mutateAsync({ id: rowId, checked: true, ...(withLabel ? { scannedProductId: product.id } : {}) });
      onAddedToCart?.(rowId, product);
      onDone(`${name} is in your cart`);
    } catch (e) {
      if (withLabel && rowId && e instanceof ApiError && e.code === "PRODUCT_ITEM_MISMATCH") {
        setMismatchRow(rowId);
        setError(`This label doesn't match the ${row?.item.name ?? name} on your list.`);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (mismatchRow) {
    return (
      <View style={styles.col} testID="scan-actions-mismatch">
        {error ? <Note text={error} tone="error" testID="scan-action-error" /> : null}
        <ScanButton label="Add to cart without the label" onPress={() => void put(false)} loading={busy} testID="scan-add-without-label" />
      </View>
    );
  }

  if (row?.checked) {
    return (
      <View style={styles.col} testID="scan-actions-in-cart">
        <Note text={`${row.item.name} is already in your cart.`} tone="ok" testID="scan-already-in-cart" />
      </View>
    );
  }

  const label = row ? (warnMe ? "Add to cart anyway" : "Add to cart") : "Not on your list — add to cart anyway";
  return (
    <View style={styles.col} testID="scan-actions-shopping">
      {row ? (
        <Note text={`On your list: ${row.item.name}${row.quantityText ? ` (${row.quantityText})` : ""}`} testID="scan-list-match" />
      ) : (
        <Note text={`${name} isn't on your shopping list.`} testID="scan-not-on-list" />
      )}
      {error ? <Note text={error} tone="error" testID="scan-action-error" /> : null}
      <ScanButton
        label={label}
        onPress={() => void put(true)}
        loading={busy}
        accessibilityHint={warnMe ? "This product has one of your allergens" : undefined}
        testID="scan-add-to-cart"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: 10 },
  note: { borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
});
