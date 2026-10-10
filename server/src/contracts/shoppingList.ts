import { z } from "zod";
import { Allergen } from "./dietary.js";
import { ItemRef } from "./items.js";

export const ListReason = z.enum(["preference", "manual"]);

export const AllergenFlag = z.object({ userId: z.uuid(), displayName: z.string(), allergen: Allergen });
export type AllergenFlag = z.infer<typeof AllergenFlag>;

export const ShoppingListItem = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  itemId: z.uuid(),
  item: ItemRef,
  reason: ListReason,
  /** Members whose preferences include this item. */
  wantedBy: z.array(z.object({ userId: z.uuid(), displayName: z.string() })),
  quantityText: z.string().nullable(),
  /** Red badges: members allergic to something in this item. */
  allergenFlags: z.array(AllergenFlag),
  checked: z.boolean(),
  checkedBy: z.uuid().nullable(),
  checkedAt: z.string().nullable(),
  scannedProductId: z.uuid().nullable(),
  addedBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShoppingListItem = z.infer<typeof ShoppingListItem>;

export const AddListItemBody = z.object({
  itemId: z.uuid(),
  quantityText: z.string().trim().max(100).nullable().optional(),
});
export type AddListItemBody = z.infer<typeof AddListItemBody>;

export const CheckListItemBody = z.object({
  checked: z.boolean(),
  /** Product scanned while checking off (08). null unlinks it. */
  scannedProductId: z.uuid().nullable().optional(),
});
export type CheckListItemBody = z.infer<typeof CheckListItemBody>;

export const CompleteTripResponse = z.object({ movedToCabinet: z.number().int() });
