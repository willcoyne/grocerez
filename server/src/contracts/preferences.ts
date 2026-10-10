import { z } from "zod";
import { Item } from "./items.js";

export const Recurrence = z.enum(["staple", "one_time"]);

export const Preference = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  userId: z.uuid(),
  item: Item,
  quantityText: z.string().nullable(),
  recurrence: Recurrence,
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Only with ?userId=all: display names of every member who wants this item.
  wantedBy: z.array(z.string()).optional(),
});
export type Preference = z.infer<typeof Preference>;

export const PreferencesQuery = z.object({ userId: z.enum(["me", "all"]).default("me") });

const quantityText = z.string().trim().min(1).max(50).nullable().optional();
const note = z.string().trim().min(1).max(200).nullable().optional();

export const CreatePreferenceBody = z.object({ itemId: z.uuid(), quantityText, recurrence: Recurrence.optional(), note }).strict();
export type CreatePreferenceBody = z.infer<typeof CreatePreferenceBody>;

export const UpdatePreferenceBody = z.object({ quantityText, recurrence: Recurrence.optional(), note }).strict();
export type UpdatePreferenceBody = z.infer<typeof UpdatePreferenceBody>;

export const PreferenceParams = z.object({ groupId: z.uuid(), id: z.uuid() });
