import { z } from "zod";
import { Item } from "./items.js";

export const StockStatus = z.enum(["in_stock", "running_low"]);
export const Location = z.enum(["fridge", "freezer", "pantry", "other"]);

export const CabinetItem = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  item: Item,
  productId: z.uuid().nullable(), // backend/08 adds the product join (brand, image)
  status: StockStatus,
  quantityText: z.string().nullable(),
  location: Location.nullable(),
  purchasedAt: z.string().nullable(),
  expiresAt: z.iso.date().nullable(), // YYYY-MM-DD
  expirationSource: z.enum(["manual", "estimated"]).nullable(),
  photoUrl: z.string().nullable(), // presigned GET, 1 h
  addedBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CabinetItem = z.infer<typeof CabinetItem>;

export const CabinetQuery = z.object({ location: Location.optional(), status: StockStatus.optional() });
export type CabinetQuery = z.infer<typeof CabinetQuery>;

const quantityText = z.string().trim().min(1).max(50).nullable().optional();
const expiresAt = z.iso.date().nullable().optional();

export const CreateCabinetBody = z
  .object({ itemId: z.uuid(), location: Location.nullable().optional(), quantityText, expiresAt })
  .strict();
export type CreateCabinetBody = z.infer<typeof CreateCabinetBody>;

export const UpdateCabinetBody = z
  .object({
    status: StockStatus.optional(),
    expiresAt,
    location: Location.nullable().optional(),
    quantityText,
    photoKey: z.string().max(200).nullable().optional(), // from POST /uploads/presign {purpose: "item-photo"}
  })
  .strict();
export type UpdateCabinetBody = z.infer<typeof UpdateCabinetBody>;

export const CabinetParams = z.object({ groupId: z.uuid(), id: z.uuid() });

export const RanOutResponse = z.object({ requeued: z.boolean() });
