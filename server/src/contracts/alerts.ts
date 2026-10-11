import { z } from "zod";
import { CabinetItem } from "./cabinet.js";

export const RecallAlert = z.object({
  /** recall_matches.id — use it for dismiss. */
  id: z.uuid(),
  score: z.number(),
  createdAt: z.string(),
  /** Always shown as "possible match, check your package". */
  label: z.literal("possible match, check your package"),
  cabinetItem: z.object({ id: z.uuid(), itemId: z.uuid(), name: z.string(), brand: z.string().nullable() }),
  recall: z.object({
    id: z.uuid(),
    source: z.string(),
    externalId: z.string(),
    productDescription: z.string(),
    reason: z.string().nullable(),
    classification: z.string().nullable(),
    firm: z.string().nullable(),
    distribution: z.string().nullable(),
    reportDate: z.string().nullable(),
    status: z.string().nullable(),
    /** openFDA link for this recall number (null for the seeded demo recall). */
    url: z.string().nullable(),
  }),
});
export type RecallAlert = z.infer<typeof RecallAlert>;

export const AlertsResponse = z.object({
  /** Cabinet items expiring within 3 days, including already expired, soonest first. */
  expiring: z.array(CabinetItem),
  recalls: z.array(RecallAlert),
});
export type AlertsResponse = z.infer<typeof AlertsResponse>;

export const DismissParams = z.object({ groupId: z.uuid(), matchId: z.uuid() });
