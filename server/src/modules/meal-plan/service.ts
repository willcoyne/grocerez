import { PlanMeal } from "../../contracts/agent.js";
import type { MealPlanResponse, PlannedMeal, PlannedMealSafety } from "../../contracts/mealPlan.js";
import { prisma, type Tx } from "../../db.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { fromCalendarDate, groupTimeZone, householdToday, toCalendarDate } from "../../lib/expiration.js";
import { emitGroup } from "../../lib/realtime.js";
import { assertMealsSafe, resolveWanted, writeWanted, type Skipped } from "../agent/listWriter.js";
import { withRegeneration } from "../shopping-list/engine.js";
import { coverage, deadlineFor, toExpirables, warningsFor, type Expirable } from "./expiry.js";
import { mealPlanRepo, rowDate, type PlannedMealRow } from "./repo.js";

const MAX_RANGE_DAYS = 31;
const DEFAULT_RUN_DAYS = 3;
/** How far ahead a run (or apply) may plan, from household today. */
export const PLAN_HORIZON_DAYS = 30;
/** alreadyPlanned window around a run's dates. */
const NEARBY_DAYS = 7;

export const addDays = (date: string, n: number) => toCalendarDate(new Date(fromCalendarDate(date).getTime() + n * 86_400_000))!;
const daysBetween = (a: string, b: string) => Math.round((fromCalendarDate(b).getTime() - fromCalendarDate(a).getTime()) / 86_400_000);

export const householdTodayOf = async (groupId: string) => toCalendarDate(householdToday(await groupTimeZone(prisma, groupId)))!;

const usesOf = (r: PlannedMealRow) => ((r.meal as { uses?: string[] } | null)?.uses ?? []);

function toPlanned(r: PlannedMealRow, cabinet: Expirable[]): PlannedMeal {
  const date = rowDate(r);
  return {
    warnings: warningsFor(usesOf(r), date, cabinet),
    id: r.id,
    groupId: r.groupId,
    date,
    slot: r.slot,
    meal: { ...(r.meal as unknown as PlanMeal), date },
    safety: (r.safety as PlannedMealSafety | null) ?? null,
    agentRunId: r.agentRunId,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function storedMeal(r: PlannedMealRow): PlanMeal {
  const parsed = PlanMeal.safeParse(r.meal);
  if (!parsed.success) throw new AppError(500, "MEAL_CORRUPT", "This planned meal is damaged");
  return parsed.data;
}

/**
 * Spec §14: a meal dated after the expiry of a cabinet item it uses moves to the latest FREE date in today…deadline
 * (free = nothing planned there and not taken by another meal of this apply). No free date → it keeps its date (warned on read).
 * Mutates `byDate`. Tightest deadlines are placed first.
 */
async function meetDeadlines(tx: Tx, groupId: string, today: string, last: string, byDate: Map<string, PlanMeal>) {
  const cabinet = toExpirables(await mealPlanRepo.expirable(tx, groupId));
  if (cabinet.length === 0) return;
  const late = [...byDate]
    .map(([date, meal]) => ({ date, meal, deadline: deadlineFor(meal.uses, cabinet) }))
    .filter((x): x is typeof x & { deadline: string } => x.deadline !== null && x.deadline < x.date)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (late.length === 0) return;
  const existing = new Set((await mealPlanRepo.list(tx, groupId, today, last)).map(rowDate));
  const claimed = new Set(byDate.keys());
  for (const x of late) {
    for (let d = x.deadline; d >= today; d = addDays(d, -1)) {
      if (existing.has(d) || claimed.has(d)) continue;
      byDate.delete(x.date);
      claimed.delete(x.date);
      claimed.add(d);
      byDate.set(d, { ...x.meal, date: d });
      break;
    }
  }
}

const changed = (groupId: string, by: string) => emitGroup(groupId, "meal-plan:changed", by);

export const mealPlanService = {
  /** GET /meal-plan?from&to (inclusive). Defaults: household today → today+6; at most 31 days. */
  async list(groupId: string, q: { from?: string; to?: string }): Promise<MealPlanResponse> {
    const today = await householdTodayOf(groupId);
    const from = q.from ?? today;
    const to = q.to ?? addDays(from, 6);
    if (from > to) throw badRequest("`from` must not be after `to`", "INVALID_RANGE");
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw badRequest(`At most ${MAX_RANGE_DAYS} days at a time`, "INVALID_RANGE");
    const weekEnd = addDays(today, 6);
    // One cabinet query + one planned-meals query covering both the requested range and today…today+6.
    const [cabinet, rows] = await Promise.all([
      mealPlanRepo.expirable(prisma, groupId).then(toExpirables),
      mealPlanRepo.list(prisma, groupId, from < today ? from : today, to > weekEnd ? to : weekEnd),
    ]);
    const expiring = coverage(
      cabinet,
      rows.map((r) => ({ id: r.id, date: rowDate(r), uses: usesOf(r) })),
      today,
      weekEnd,
      addDays(today, 7),
      daysBetween,
    );
    const meals = rows.filter((r) => rowDate(r) >= from && rowDate(r) <= to).map((r) => toPlanned(r, cabinet));
    return { from, to, today, meals, expiring };
  },

  /** POST /meal-plan: add a dinner by hand. Safety-checked like apply (422 PLAN_UNSAFE); 409 DATE_TAKEN. */
  async add(groupId: string, userId: string, body: { date: string; meal: PlanMeal }): Promise<PlannedMeal> {
    const meal = { ...body.meal, date: body.date };
    const [safety] = await assertMealsSafe(groupId, [meal], []);
    const row = await prisma.$transaction(async (tx) => {
      await mealPlanRepo.lock(tx, groupId);
      if (await mealPlanRepo.findByDate(tx, groupId, body.date)) throw conflict("A dinner is already planned that day", "DATE_TAKEN");
      return mealPlanRepo.create(tx, groupId, body.date, meal, userId, null, safety);
    });
    changed(groupId, userId);
    return toPlanned(row, toExpirables(await mealPlanRepo.expirable(prisma, groupId)));
  },

  /** PATCH /meal-plan/:id: move to `date`; if that day is planned, the two meals swap days (one transaction). */
  async move(groupId: string, userId: string, id: string, date: string): Promise<PlannedMeal> {
    const { row, wrote } = await prisma.$transaction(async (tx) => {
      await mealPlanRepo.lock(tx, groupId);
      const row = await mealPlanRepo.find(tx, groupId, id);
      if (!row) throw notFound("Planned meal");
      const from = rowDate(row);
      if (from === date) return { row, wrote: false };
      const other = await mealPlanRepo.findByDate(tx, groupId, date);
      if (other) {
        await mealPlanRepo.park(tx, groupId, row.id);
        await mealPlanRepo.setDate(tx, groupId, other.id, from, storedMeal(other));
      }
      return { row: await mealPlanRepo.setDate(tx, groupId, row.id, date, storedMeal(row)), wrote: true };
    });
    if (wrote) changed(groupId, userId);
    return toPlanned(row, toExpirables(await mealPlanRepo.expirable(prisma, groupId)));
  },

  async remove(groupId: string, userId: string, id: string): Promise<void> {
    if ((await mealPlanRepo.remove(groupId, id)) === 0) throw notFound("Planned meal");
    changed(groupId, userId);
  },

  /** POST /meal-plan/:id/add-missing: the meal's `missing` onto the list, through the same path as agent apply. */
  async addMissing(groupId: string, userId: string, id: string): Promise<{ added: number; skipped: Skipped }> {
    const row = await mealPlanRepo.find(prisma, groupId, id);
    if (!row) throw notFound("Planned meal");
    const meal = storedMeal(row);
    const items = [...new Set(meal.missing)].map((name) => ({ name, forMeals: [meal.title] }));
    await assertMealsSafe(groupId, [meal], items);
    const wanted = await resolveWanted(groupId, userId, items);
    const { result } = await withRegeneration(groupId, userId, ["shopping-list:changed"], (tx) =>
      writeWanted(tx, groupId, userId, wanted, row.agentRunId),
    );
    return { added: result.ids.length, skipped: result.skipped };
  },

  // ─── Agent runs (spec §13) ─────────────────────────────────────────────────

  /**
   * The dates a run plans: a swap → the replaced meal's date only; else body.dates (unique, today…today+30) or,
   * when omitted, the next 3 days. Also returns the planned meals within ±7 days (minus the replaced one).
   */
  async runDates(groupId: string, body: { dates?: string[]; replacePlannedMealId?: string }) {
    const today = await householdTodayOf(groupId);
    let dates: string[];
    let replace: PlannedMealRow | null = null;
    if (body.replacePlannedMealId) {
      replace = await mealPlanRepo.find(prisma, groupId, body.replacePlannedMealId);
      if (!replace) throw notFound("Planned meal");
      dates = [rowDate(replace)];
    } else if (body.dates) {
      dates = body.dates;
      if (new Set(dates).size !== dates.length) throw badRequest("Dates must be unique", "INVALID_DATES");
      const last = addDays(today, PLAN_HORIZON_DAYS);
      if (dates.some((d) => d < today || d > last)) {
        throw badRequest(`Dates must be between ${today} and ${last}`, "INVALID_DATES");
      }
    } else {
      dates = Array.from({ length: DEFAULT_RUN_DAYS }, (_, i) => addDays(today, i));
    }
    const sorted = [...dates].sort();
    const nearby = await mealPlanRepo.list(prisma, groupId, addDays(sorted[0], -NEARBY_DAYS), addDays(sorted.at(-1)!, NEARBY_DAYS));
    const alreadyPlanned = nearby
      .filter((r) => r.id !== replace?.id)
      .map((r) => ({ date: rowDate(r), title: storedMeal(r).title }))
      .slice(0, 31);
    return { dates: sorted, alreadyPlanned, replacePlannedMealId: replace?.id ?? null };
  },

  /**
   * Inside apply's transaction: plan every meal that has a date within today…today+30 (first meal per date wins).
   * A swap run only replaces its row's meal (if the row still exists); other runs upsert by date, replacing what's there.
   * Returns how many planned meals were written.
   */
  async writeForRun(
    tx: Tx,
    groupId: string,
    userId: string,
    runId: string,
    meals: PlanMeal[],
    replacePlannedMealId: string | null,
    safetyByIndex: (PlannedMealSafety | undefined)[] = [],
  ): Promise<number> {
    // meetDeadlines may re-date a meal (new object), so safety follows the meal by title.
    const safetyOf = new Map<string, PlannedMealSafety>();
    meals.forEach((m, i) => safetyByIndex[i] && !safetyOf.has(m.title) && safetyOf.set(m.title, safetyByIndex[i]!));
    const safeFor = (m: PlanMeal) => safetyOf.get(m.title) ?? null;
    const today = toCalendarDate(householdToday(await groupTimeZone(tx, groupId)))!;
    const last = addDays(today, PLAN_HORIZON_DAYS);
    const byDate = new Map<string, PlanMeal>();
    for (const m of meals) if (m.date && m.date >= today && m.date <= last && !byDate.has(m.date)) byDate.set(m.date, m);
    await mealPlanRepo.lock(tx, groupId);
    if (!replacePlannedMealId) await meetDeadlines(tx, groupId, today, last, byDate);

    if (replacePlannedMealId) {
      const row = await mealPlanRepo.find(tx, groupId, replacePlannedMealId);
      if (row) {
        const date = rowDate(row);
        const meal = byDate.get(date) ?? meals[0];
        await mealPlanRepo.replaceMeal(tx, groupId, row.id, date, meal, runId, safeFor(meal));
        return 1;
      }
    }
    for (const [date, meal] of byDate) await mealPlanRepo.upsertOnDate(tx, groupId, date, meal, userId, runId, safeFor(meal));
    return byDate.size;
  },
};
