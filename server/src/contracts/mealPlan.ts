import { z } from "zod";
import { CalendarDate } from "./common.js";
import { PlanMeal, SafetyProblem } from "./agent.js";

// Week calendar (plan/challenges/01-pantry-agent §13). One dinner per date per group.

export const MealSlot = z.enum(["dinner"]);
export type MealSlot = z.infer<typeof MealSlot>;

/** A cabinet item this meal relies on that expires before the meal's date (spec §14). */
export const ExpiryWarning = z.object({
  kind: z.literal("expires_before"),
  /** Cabinet item name, e.g. "Spinach". */
  item: z.string(),
  /** YYYY-MM-DD */
  expiresAt: CalendarDate,
});
export type ExpiryWarning = z.infer<typeof ExpiryWarning>;

/** The household safety check of a saved meal, as it was when the meal was written. */
export const PlannedMealSafety = z.object({
  passes: z.boolean(),
  problems: z.array(SafetyProblem),
  unknown: z.array(z.string()),
});
export type PlannedMealSafety = z.infer<typeof PlannedMealSafety>;

export const PlannedMeal = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  /** YYYY-MM-DD in the household's time zone. */
  date: CalendarDate,
  slot: MealSlot,
  meal: PlanMeal,
  /** Safety result stored when the meal was written; null for rows saved before it was recorded. */
  safety: PlannedMealSafety.nullable().default(null),
  /** The agent run that planned it; null when added by hand. */
  agentRunId: z.uuid().nullable(),
  /** Computed on read: cabinet items this meal uses that expire before `date`. Empty = fine. */
  warnings: z.array(ExpiryWarning).default([]),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlannedMeal = z.infer<typeof PlannedMeal>;

/** GET /groups/:gid/meal-plan?from&to (inclusive, ≤ 31 days). Defaults: today → today+6. */
export const MealPlanQuery = z.object({ from: CalendarDate.optional(), to: CalendarDate.optional() });
export const MealPlanResponse = z.object({
  from: CalendarDate,
  to: CalendarDate,
  /** Household "today", so the app doesn't guess the time zone. */
  today: CalendarDate,
  meals: z.array(PlannedMeal),
  /**
   * Cabinet items expiring within 7 days of today (or already expired), soonest first, and which planned meal (if any)
   * in the next 7 days uses each. plannedOn null = "use soon, not planned".
   */
  expiring: z.array(
    z.object({
      cabinetItemId: z.uuid(),
      name: z.string(),
      expiresAt: CalendarDate,
      /** Negative = already expired. */
      daysLeft: z.number().int(),
      plannedOn: CalendarDate.nullable(),
      plannedMealId: z.uuid().nullable(),
    }),
  ).default([]),
});
export type MealPlanResponse = z.infer<typeof MealPlanResponse>;

/** POST /groups/:gid/meal-plan: add by hand. The server safety-checks the meal (422 PLAN_UNSAFE); 409 DATE_TAKEN if planned. */
export const AddPlannedMealBody = z.object({ date: CalendarDate, meal: PlanMeal });

/** PATCH /groups/:gid/meal-plan/:id: move. If the target date is planned, the two meals swap dates. */
export const MovePlannedMealBody = z.object({ date: CalendarDate });

export const PlannedMealParams = z.object({ groupId: z.uuid(), id: z.uuid() });

/** POST /groups/:gid/meal-plan/:id/add-missing → put this meal's missing items on the list (same rules as apply). */
export const AddMissingResponse = z.object({
  added: z.number().int(),
  skipped: z.array(z.object({ name: z.string(), reason: z.enum(["in_cabinet", "on_list"]) })),
});
