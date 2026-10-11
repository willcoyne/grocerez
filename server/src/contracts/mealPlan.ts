import { z } from "zod";
import { CalendarDate } from "./common.js";
import { PlanMeal } from "./agent.js";

// Week calendar (plan/challenges/01-pantry-agent §13). One dinner per date per group.

export const MealSlot = z.enum(["dinner"]);
export type MealSlot = z.infer<typeof MealSlot>;

export const PlannedMeal = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  /** YYYY-MM-DD in the household's time zone. */
  date: CalendarDate,
  slot: MealSlot,
  meal: PlanMeal,
  /** The agent run that planned it; null when added by hand. */
  agentRunId: z.uuid().nullable(),
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
