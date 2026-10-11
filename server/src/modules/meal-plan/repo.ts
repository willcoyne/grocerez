import type { Prisma } from "../../../generated/prisma/client.js";
import type { PlanMeal } from "../../contracts/agent.js";
import { prisma, type Db, type Tx } from "../../db.js";
import { fromCalendarDate, toCalendarDate } from "../../lib/expiration.js";

const SLOT = "dinner" as const;
/** Parking date for a swap: the unique (group_id, date, slot) index can't be deferred, so one row steps aside. */
const SWAP_PARKING = fromCalendarDate("1900-01-01");

const json = (meal: PlanMeal, date: string) => ({ ...meal, date }) as unknown as Prisma.InputJsonValue;

/** Every function takes groupId and filters by it. */
export const mealPlanRepo = {
  /** Serializes meal-plan writes per group (moves/swaps, manual adds, apply), like lockGroup for the list. */
  lock: (tx: Tx, groupId: string) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('meal_plan:' || ${groupId}::text, 0))`,

  list: (db: Db, groupId: string, from: string, to: string) =>
    db.plannedMeal.findMany({
      where: { groupId, date: { gte: fromCalendarDate(from), lte: fromCalendarDate(to) } },
      orderBy: { date: "asc" },
    }),

  find: (db: Db, groupId: string, id: string) => db.plannedMeal.findFirst({ where: { id, groupId } }),

  findByDate: (db: Db, groupId: string, date: string) =>
    db.plannedMeal.findUnique({ where: { groupId_date_slot: { groupId, date: fromCalendarDate(date), slot: SLOT } } }),

  create: (tx: Tx, groupId: string, date: string, meal: PlanMeal, createdBy: string, agentRunId: string | null) =>
    tx.plannedMeal.create({
      data: { groupId, date: fromCalendarDate(date), slot: SLOT, meal: json(meal, date), createdBy, agentRunId },
    }),

  /** Sets a row's date (and the date inside its meal json). */
  setDate: (tx: Tx, groupId: string, id: string, date: string, meal: PlanMeal) =>
    tx.plannedMeal.update({ where: { id, groupId }, data: { date: fromCalendarDate(date), meal: json(meal, date) } }),

  park: (tx: Tx, groupId: string, id: string) =>
    tx.plannedMeal.update({ where: { id, groupId }, data: { date: SWAP_PARKING } }),

  remove: async (groupId: string, id: string) => (await prisma.plannedMeal.deleteMany({ where: { id, groupId } })).count,

  /** Replaces the meal on an existing row (swap run), keeping its date. */
  replaceMeal: (tx: Tx, groupId: string, id: string, date: string, meal: PlanMeal, agentRunId: string) =>
    tx.plannedMeal.update({ where: { id, groupId }, data: { meal: json(meal, date), agentRunId } }),

  /** Plans `meal` on `date`: creates the row, or replaces the meal already planned there. */
  upsertOnDate: (tx: Tx, groupId: string, date: string, meal: PlanMeal, createdBy: string, agentRunId: string) =>
    tx.plannedMeal.upsert({
      where: { groupId_date_slot: { groupId, date: fromCalendarDate(date), slot: SLOT } },
      create: { groupId, date: fromCalendarDate(date), slot: SLOT, meal: json(meal, date), createdBy, agentRunId },
      update: { meal: json(meal, date), agentRunId },
    }),
};

export type PlannedMealRow = NonNullable<Awaited<ReturnType<typeof mealPlanRepo.find>>>;
export const rowDate = (r: { date: Date }) => toCalendarDate(r.date)!;
