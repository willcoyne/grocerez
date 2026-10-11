import { z } from "zod";

export const Uuid = z.uuid();
export const IdParams = z.object({ id: Uuid });
export const GroupParams = z.object({ groupId: Uuid });
export const GroupIdParams = z.object({ groupId: Uuid, id: Uuid });

/** Standard error body: { error: { code, message, details? } }. */
export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** Dates are ISO-8601 strings on the wire. Calendar dates (expiresAt) are YYYY-MM-DD. */
export const IsoDateTime = z.string();
export const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const y = Number(s.slice(0, 4));
    if (y < 2000 || y > 2100) return false;
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "expected a real calendar date between 2000 and 2100");

/** Item categories in store-aisle order (the shopping list sort order). */
export const CATEGORIES = [
  "produce", "bakery", "meat", "seafood", "dairy", "frozen", "pantry", "snacks", "beverages", "household", "other",
] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;
