import type { ShoppingListItem } from "@contracts/shoppingList";

import { labelize } from "./format";

/** Sections in the server's aisle order; inside each, unchecked first, checked at the bottom. */
export function toSections(rows: ShoppingListItem[]) {
  const order: string[] = [];
  const bySection = new Map<string, ShoppingListItem[]>();
  for (const r of rows) {
    const cat = r.item.category ?? "other";
    if (!bySection.has(cat)) {
      bySection.set(cat, []);
      order.push(cat);
    }
    bySection.get(cat)!.push(r);
  }
  return order.map((cat) => {
    const data = bySection.get(cat)!;
    return { title: labelize(cat), data: [...data.filter((r) => !r.checked), ...data.filter((r) => r.checked)] };
  });
}
