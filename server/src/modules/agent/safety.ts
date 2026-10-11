import { prisma } from "../../db.js";
import type { SafetyCheckResponse } from "../../contracts/agent.js";
import { DIETS, type Allergen, type Diet } from "../../contracts/dietary.js";
import { allergensInText } from "../../lib/allergens.js";
import { conflicts } from "../../lib/diets.js";
import { itemsService } from "../items/service.js";
import { agentRepo } from "./repo.js";

/** One keyword per allergen that allergensInText() recognises, used to fold catalog allergens into the checked text. */
const ALLERGEN_WORD: Record<Allergen, string> = {
  milk: "milk", eggs: "egg", fish: "fish", shellfish: "shellfish", tree_nuts: "tree nut",
  peanuts: "peanut", wheat: "wheat", soy: "soy", sesame: "sesame", gluten: "gluten",
};

/** Catalog categories that break a diet even when the item's name has no meat/fish keyword ("Hot Dogs"). */
const CATEGORY_DIETS: Record<string, Diet[]> = {
  meat: ["vegetarian", "vegan", "pescatarian"],
  seafood: ["vegetarian", "vegan"],
};

type Member = Awaited<ReturnType<typeof agentRepo.members>>[number];
type Problem = SafetyCheckResponse["meals"][number]["problems"][number];
type CatalogFacts = { name: string; defaultAllergens: Allergen[]; category: string | null };
type Analysis = { text: string; category: string | null; unknown: boolean };

/** Meal as checked: title + ingredients (+ steps when apply checks a stored plan). */
export type SafetyMeal = { title: string; ingredients: string[]; steps?: string[] };

const withCatalog = (text: string, allergens: Allergen[]) => [text, ...allergens.map((a) => ALLERGEN_WORD[a])].join("; ");

/** Everything wrong with `text` (+ a catalog category) for one member: allergens and diets (lib/diets conflicts()). */
function reasonsFor(m: Member, text: string, category: string | null): string[] {
  const out = new Set(conflicts(text, m.diets, m.allergens));
  for (const d of CATEGORY_DIETS[category ?? ""] ?? []) if (m.diets.includes(d)) out.add(`not ${d.replace("_", "-")}`);
  return [...out];
}

/**
 * Catalog lookup for one ingredient. Any exact/suggested hit contributes its defaultAllergens and category (fail safe),
 * but only an EXACT hit (or an allergen/diet keyword in the ingredient itself) makes it "known": a fuzzy suggestion
 * ("Custard" → "Mustard") is not evidence of what the ingredient is, so it is also listed in `unknown`.
 * Catalog allergens are added as keywords, "; "-separated so EXCLUDE phrases ("almond milk") can't form across them.
 */
async function analyse(ingredient: string): Promise<Analysis> {
  const res = await itemsService.search(ingredient, prisma).catch(() => null);
  const hit = res && res.match !== "none" ? res.results[0] : null;
  const keywordHit = allergensInText(ingredient).length > 0 || conflicts(ingredient, [...DIETS], []).length > 0;
  return {
    text: withCatalog(ingredient, hit?.defaultAllergens ?? []),
    category: hit?.category ?? null,
    unknown: res?.match !== "exact" && !keywordHit,
  };
}

function collect(problems: Map<string, Problem>, members: Member[], subject: string, text: string, category: string | null) {
  for (const m of members) {
    for (const reason of reasonsFor(m, text, category)) {
      const key = `${subject}\u0000${reason}`;
      const p = problems.get(key) ?? { ingredient: subject, reason, members: [] };
      if (!p.members.includes(m.displayName)) p.members.push(m.displayName);
      problems.set(key, p);
    }
  }
}

const sortedMembers = async (groupId: string) =>
  (await agentRepo.members(groupId)).sort((a, b) => a.displayName.localeCompare(b.displayName));

/**
 * THE meal safety check (challenge 01 §4.3), used by POST /agent/safety-check and by apply.
 * Pure function of DB state, evaluated against EACH member so problems name who they affect:
 *  - every ingredient: keywords + catalog allergens + catalog category;
 *  - the title and every step: keywords (people cook what the title and steps say, not just the ingredient list).
 * Known conflicts fail the meal; unknown ingredients don't.
 */
async function check(groupId: string, meals: SafetyMeal[]): Promise<SafetyCheckResponse> {
  const members = await sortedMembers(groupId);
  const cache = new Map<string, Promise<Analysis>>();
  const lookup = (ingredient: string) => {
    const key = ingredient.trim().toLowerCase();
    if (!cache.has(key)) cache.set(key, analyse(ingredient));
    return cache.get(key)!;
  };

  const out: SafetyCheckResponse["meals"] = [];
  for (const meal of meals) {
    const problems = new Map<string, Problem>();
    const unknown: string[] = [];
    for (const ingredient of meal.ingredients) {
      const a = await lookup(ingredient);
      if (a.unknown && !unknown.includes(ingredient)) unknown.push(ingredient);
      collect(problems, members, ingredient, a.text, a.category);
    }
    for (const text of [meal.title, ...(meal.steps ?? [])]) collect(problems, members, text, text, null);
    out.push({ title: meal.title, passes: problems.size === 0, problems: [...problems.values()], unknown });
  }
  return { meals: out };
}

/** The catalog items apply is about to put on the list, checked by their own defaultAllergens and category. */
async function checkItems(groupId: string, items: CatalogFacts[]): Promise<Problem[]> {
  const members = await sortedMembers(groupId);
  const problems = new Map<string, Problem>();
  for (const it of items) collect(problems, members, it.name, withCatalog(it.name, it.defaultAllergens), it.category);
  return [...problems.values()];
}

export const safety = { check, checkItems };
