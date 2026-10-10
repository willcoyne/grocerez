import { z } from "zod";
import { CalendarDate } from "./common.js";
import { ItemRef } from "./items.js";

export const StockStatus = z.enum(["in_stock", "running_low"]);
export const Location = z.enum(["fridge", "freezer", "pantry", "other"]);
export const ExpirationSource = z.enum(["manual", "estimated"]);

export const CabinetQuery = z.object({
  location: Location.optional(),
  status: StockStatus.optional(),
});

export const AddCabinetBody = z.object({
  itemId: z.uuid(),
  location: Location.optional(),
  quantityText: z.string().trim().max(100).nullable().optional(),
  /** YYYY-MM-DD. Missing → estimated from the item's shelf life (expirationSource "estimated"). */
  expiresAt: CalendarDate.optional(),
});
export type AddCabinetBody = z.infer<typeof AddCabinetBody>;

export const UpdateCabinetBody = z.object({
  status: StockStatus.optional(),
  /** YYYY-MM-DD sets a manual date; null clears the date. */
  expiresAt: CalendarDate.nullable().optional(),
  location: Location.nullable().optional(),
  quantityText: z.string().trim().max(100).nullable().optional(),
  /** `key` from POST /uploads/presign {purpose:"item-photo"} (11). null removes the photo. */
  photoKey: z.string().max(200).nullable().optional(),
});
export type UpdateCabinetBody = z.infer<typeof UpdateCabinetBody>;

export const ProductRef = z.object({
  id: z.uuid(),
  brand: z.string().nullable(),
  name: z.string(),
  /** Presigned S3 GET URL (11), or null. */
  imageUrl: z.string().nullable(),
});

export const CabinetItem = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  itemId: z.uuid(),
  item: ItemRef,
  product: ProductRef.nullable(),
  status: StockStatus,
  quantityText: z.string().nullable(),
  location: Location.nullable(),
  purchasedAt: z.string().nullable(),
  /** YYYY-MM-DD */
  expiresAt: z.string().nullable(),
  expirationSource: ExpirationSource.nullable(),
  /** Presigned S3 GET URL of an uploaded item photo (11), or null. */
  photoUrl: z.string().nullable(),
  addedBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CabinetItem = z.infer<typeof CabinetItem>;

export const RanOutResponse = z.object({ requeued: z.boolean() });
