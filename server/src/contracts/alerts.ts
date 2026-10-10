import { z } from "zod";
import { CabinetItem } from "./cabinet.js";
import { Item } from "./items.js";

// A possible recall match: "possible match, check your package". Never acted on automatically.
export const RecallAlert = z.object({
  id: z.uuid(), // matchId for /dismiss
  cabinetItemId: z.uuid(),
  item: Item,
  score: z.number(),
  createdAt: z.string(),
  recall: z.object({
    externalId: z.string(), // openFDA recall_number
    productDescription: z.string(),
    reason: z.string().nullable(),
    classification: z.string().nullable(),
    firm: z.string().nullable(),
    distribution: z.string().nullable(),
    reportDate: z.iso.date().nullable(),
    status: z.string().nullable(),
    link: z.string(),
  }),
});
export type RecallAlert = z.infer<typeof RecallAlert>;

export const Alerts = z.object({ expiring: z.array(CabinetItem), recalls: z.array(RecallAlert) });
export type Alerts = z.infer<typeof Alerts>;

export const DismissParams = z.object({ groupId: z.uuid(), matchId: z.uuid() });
