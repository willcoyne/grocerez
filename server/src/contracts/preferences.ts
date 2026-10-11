import { z } from "zod";
import { Item } from "./items.js";

export const Recurrence = z.enum(["staple", "one_time"]);

export const PreferencesQuery = z.object({ userId: z.enum(["me", "all"]).default("me") });

export const CreatePreferenceBody = z.object({
  itemId: z.uuid(),
  quantityText: z.string().trim().max(100).nullable().optional(),
  recurrence: Recurrence.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CreatePreferenceBody = z.infer<typeof CreatePreferenceBody>;

export const UpdatePreferenceBody = CreatePreferenceBody.omit({ itemId: true });
export type UpdatePreferenceBody = z.infer<typeof UpdatePreferenceBody>;

export const Preference = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  userId: z.uuid(),
  itemId: z.uuid(),
  item: Item,
  /** The member who wants it (the "wanted by" name on the group screen). */
  user: z.object({ id: z.uuid(), displayName: z.string() }),
  quantityText: z.string().nullable(),
  recurrence: Recurrence,
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Preference = z.infer<typeof Preference>;
