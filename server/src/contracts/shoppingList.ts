import { z } from "zod";
import { Allergen } from "./dietary.js";
import { Item } from "./items.js";

const Person = z.object({ userId: z.uuid(), displayName: z.string() });

export const AllergenFlag = z.object({ userId: z.uuid(), displayName: z.string(), allergen: Allergen });
export type AllergenFlag = z.infer<typeof AllergenFlag>;

export const ShoppingListItem = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  item: Item,
  reason: z.enum(["preference", "manual"]),
  wantedBy: z.array(Person), // members whose preferences put it here (may be empty for manual rows)
  quantityText: z.string().nullable(),
  allergenFlags: z.array(AllergenFlag), // every member whose allergens the item contains
  checked: z.boolean(),
  checkedBy: Person.nullable(),
  checkedAt: z.string().nullable(),
  scannedProductId: z.uuid().nullable(),
  addedBy: Person.nullable(), // manual rows
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShoppingListItem = z.infer<typeof ShoppingListItem>;

export const AddListItemBody = z
  .object({ itemId: z.uuid(), quantityText: z.string().trim().min(1).max(50).nullable().optional() })
  .strict();
export type AddListItemBody = z.infer<typeof AddListItemBody>;

export const CheckListItemBody = z.object({ checked: z.boolean(), scannedProductId: z.uuid().nullable().optional() }).strict();
export type CheckListItemBody = z.infer<typeof CheckListItemBody>;

export const ListItemParams = z.object({ groupId: z.uuid(), id: z.uuid() });

export const CompleteTripResponse = z.object({ movedToCabinet: z.number().int() });
