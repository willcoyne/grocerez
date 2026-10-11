import type { ApplyAgentRunResponse, PlanMeal, SafetyCheckResponse } from "../../contracts/agent.js";
import type { PlannedMeal } from "../../contracts/mealPlan.js";
import type { Item } from "../../contracts/items.js";
import type { Tx } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { normalize } from "../../lib/normalize.js";
import { itemsService } from "../items/service.js";
import { shoppingListRepo } from "../shopping-list/repo.js";
import { catalogMatch, safety, type SafetyMeal } from "./safety.js";

/**
 * The ONE path that turns planned meals into shopping-list rows (spec §5.2 apply, §13 "Add missing to List"):
 * safety check → resolve names to catalog items → (in the caller's withRegeneration transaction) skip what's in the
 * cabinet or already on the list, upsert the rest as manual rows with "✨ for <meals>" notes.
 */

const NOTE_MAX = 120;

/** One meal's stored safety result (same shape as PlannedMeal.safety). */
export type MealSafetyResult = NonNullable<PlannedMeal["safety"]>;
export type MissingItem = { name: string; forMeals: string[] };
type Problems = SafetyCheckResponse["meals"][number]["problems"];
export type Wanted = Map<string, { name: string; forMeals: string[]; item: Item }>;
export type Skipped = ApplyAgentRunResponse["skipped"];

export function unsafe(failing: { title: string; problems: Problems }[]) {
  const first = failing[0].problems[0];
  return new AppError(
    422,
    "PLAN_UNSAFE",
    `This plan isn't safe for everyone: ${first.ingredient} (${first.reason}: ${first.members.join(", ")})`,
    { meals: failing.map((m) => ({ title: m.title, problems: m.problems })) },
  );
}

export const noteFor = (forMeals: string[]) => Array.from(`✨ for ${forMeals.join(", ")}`).slice(0, NOTE_MAX).join("");

/**
 * Safety-checks everything the meals tell people to buy or cook, not only ingredients[]: missing/uses names, the
 * title, steps and the source's ingredient lines (safety.check), plus the items that will be written ("To buy").
 * Throws 422 PLAN_UNSAFE.
 */
export async function assertMealsSafe(groupId: string, meals: PlanMeal[], missingItems: MissingItem[]): Promise<MealSafetyResult[]> {
  const toCheck: SafetyMeal[] = meals.map((m) => ({
    title: m.title,
    ingredients: [...new Set([...m.ingredients, ...m.missing, ...m.uses])],
    steps: m.steps,
    ingredientLines: m.ingredientLines,
  }));
  if (missingItems.length) toCheck.push({ title: "To buy", ingredients: missingItems.map((i) => i.name) });
  const results = (await safety.check(groupId, toCheck)).meals;
  const failing = results.filter((m) => !m.passes);
  if (failing.length) throw unsafe(failing);
  return results.slice(0, meals.length).map(({ passes, problems, unknown }) => ({ passes, problems, unknown }));
}

/** A name → its catalog item (verified or fuzzy match), else a new catalog item through the POST /items path. */
async function resolveItem(userId: string, name: string): Promise<Item | null> {
  if (!normalize(name)) return null;
  const m = await catalogMatch(name);
  const hit = m.verified ?? m.fallback;
  if (hit) return hit;
  return (await itemsService.create(userId, { name: name.trim().slice(0, 200) })).item;
}

/**
 * Resolves names outside any transaction (it may create catalog items), merging names that land on the same item,
 * then checks the resolved items' own allergens/category (a fuzzy match can differ from the name). Throws 422.
 */
export async function resolveWanted(groupId: string, userId: string, missingItems: MissingItem[]): Promise<Wanted> {
  const wanted: Wanted = new Map();
  for (const m of missingItems) {
    const item = await resolveItem(userId, m.name).catch((err) => {
      logger.warn({ err, name: m.name }, "could not resolve a planned item");
      return null;
    });
    if (!item) continue;
    const w = wanted.get(item.id) ?? { name: m.name, forMeals: [], item };
    for (const t of m.forMeals) if (!w.forMeals.includes(t)) w.forMeals.push(t);
    wanted.set(item.id, w);
  }
  const problems = await safety.checkItems(groupId, [...wanted.values()].map((w) => w.item));
  if (problems.length) throw unsafe([{ title: "To buy", problems }]);
  return wanted;
}

/**
 * Inside the caller's withRegeneration transaction: skip items in the cabinet (in_stock) or already on the list
 * (checked or not), upsert the rest with their notes. Returns the written row ids and what was skipped.
 */
export async function writeWanted(
  tx: Tx,
  groupId: string,
  userId: string,
  wanted: Wanted,
  agentRunId: string | null,
): Promise<{ ids: string[]; skipped: Skipped }> {
  const itemIds = [...wanted.keys()];
  const inCabinet = new Set(
    (await tx.cabinetItem.findMany({ where: { groupId, status: "in_stock", itemId: { in: itemIds } }, select: { itemId: true } }))
      .map((c) => c.itemId),
  );
  const onList = new Set(
    (await tx.shoppingListItem.findMany({ where: { groupId, itemId: { in: itemIds } }, select: { itemId: true } }))
      .map((r) => r.itemId),
  );
  const skipped: Skipped = [];
  const rows: { itemId: string; note: string }[] = [];
  for (const [itemId, w] of wanted) {
    if (inCabinet.has(itemId)) skipped.push({ name: w.name, reason: "in_cabinet" });
    else if (onList.has(itemId)) skipped.push({ name: w.name, reason: "on_list" });
    else rows.push({ itemId, note: noteFor(w.forMeals) });
  }
  const ids = await shoppingListRepo.upsertFromAgent(tx, groupId, userId, agentRunId, rows);
  return { ids, skipped };
}
