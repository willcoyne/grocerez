import type { ShoppingListItem } from "@contracts/shoppingList";

/**
 * What the scan is for:
 * - shopping: you're in the store; a scan puts the matching list row in the cart (checked with the scanned product).
 * - lookup:   just show the label (allergy warnings use `groupId`, default the active group).
 */
export type ScanContext = { kind: "shopping"; groupId: string; list: ShoppingListItem[] } | { kind: "lookup"; groupId?: string };
