import { prisma } from "../../db.js";
import type { SafetyCheckResponse } from "../../contracts/agent.js";
import { DIETS, type Allergen, type Diet } from "../../contracts/dietary.js";
import type { Item } from "../../contracts/items.js";
import { allergensInText } from "../../lib/allergens.js";
import { conflicts } from "../../lib/diets.js";
import { containsWholeWords, normalize } from "../../lib/normalize.js";
import { itemsRepo, searchRowToItem } from "../items/repo.js";
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
export type SafetyMeal = { title: string; ingredients: string[]; steps?: string[]; ingredientLines?: string[] };

const withCatalog = (text: string, allergens: Allergen[]) => [text, ...allergens.map((a) => ALLERGEN_WORD[a])].join("; ");

/** Everything wrong with `text` (+ a catalog category) for one member: allergens and diets (lib/diets conflicts()). */
function reasonsFor(m: Member, text: string, category: string | null): string[] {
  const out = new Set(conflicts(text, m.diets, m.allergens));
  for (const d of CATEGORY_DIETS[category ?? ""] ?? []) if (m.diets.includes(d)) out.add(`not ${d.replace("_", "-")}`);
  return [...out];
}

/**
 * Catalog lookup for one ingredient. Any exact/suggested hit contributes its defaultAllergens and category (fail safe).
 * The ingredient is "known" (verified) when:
 *  - the hit is EXACT, or
 *  - a candidate's (suggested or similar) normalized name appears as whole words inside the normalized ingredient
 *    ("Fresh Basil" ⊇ "basil", "Boneless Chicken Breast" ⊇ "chicken breast"), or
 *  - the ingredient itself contains an allergen/diet keyword.
 * Any other fuzzy suggestion ("Custard" → "Mustard") is not evidence of what the ingredient is → `unknown`.
 * Catalog allergens are added as keywords, "; "-separated so EXCLUDE phrases ("almond milk") can't form across them.
 */
async function analyse(ingredient: string): Promise<Analysis> {
  const m = await catalogMatch(ingredient);
  const hit = m.verified ?? m.fallback;
  const keywordHit = allergensInText(ingredient).length > 0 || conflicts(ingredient, [...DIETS], []).length > 0;
  return {
    text: withCatalog(ingredient, hit?.defaultAllergens ?? []),
    category: hit?.category ?? null,
    unknown: !m.verified && !keywordHit,
  };
}

/**
 * The catalog item an ingredient name really is: `verified` = an EXACT hit, or a candidate whose normalized name is
 * whole words inside the normalized ingredient. `fallback` = a fuzzy `suggested` hit that isn't verified (its
 * allergens are still applied by the safety check, fail safe). Shared by the safety check and recipe ingest.
 */
export async function catalogMatch(ingredient: string): Promise<{ verified: Item | null; fallback: Item | null }> {
  if (!normalize(ingredient)) return { verified: null, fallback: null };
  // The spelling search only (same match/results as itemsService.search), without its semantic `related` lookup:
  // that would cost one Akamai embedding call per unmatched ingredient and we never use it here.
  const rows = await itemsRepo.search(prisma, ingredient).catch(() => []);
  if (rows.length === 0) return { verified: null, fallback: null };
  const res = { match: rows[0].match, results: rows.map(searchRowToItem) };
  if (res.match === "exact") return { verified: res.results[0], fallback: null };
  // Containment is checked on every returned candidate: search_items classifies multi-word inputs like
  // "Fresh Basil" as `none` (similarity below the suggestion cut-off) while still returning Basil as similar.
  const norm = normalize(ingredient);
  const contained = res.results.find((r) => containsWholeWords(norm, r.normalizedName)) ?? null;
  return { verified: contained, fallback: res.match === "suggested" ? res.results[0] : null };
}

/** Reason used when an allergy household can't be sure about an ingredient (user decision: unverifiable fails). */
export const UNVERIFIED_REASON = "couldn't verify ingredients (allergy household)";

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
 * Known conflicts fail the meal. Unknown ingredients are listed in `unknown`; when ANY member has an allergen they also
 * fail the meal (problem UNVERIFIED_REASON, naming the members with allergens). Diet-only households: unknown passes.
 */
async function check(groupId: string, meals: SafetyMeal[]): Promise<SafetyCheckResponse> {
  const members = await sortedMembers(groupId);
  const allergic = members.filter((m) => m.allergens.length > 0).map((m) => m.displayName);
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
    // Catalog lookups in parallel (cached per check), then collected in ingredient order so output is unchanged.
    const analyses = await Promise.all(meal.ingredients.map(lookup));
    for (const [i, ingredient] of meal.ingredients.entries()) {
      const a = analyses[i];
      if (a.unknown && !unknown.includes(ingredient)) {
        unknown.push(ingredient);
        if (allergic.length) {
          problems.set(`${ingredient}\u0000${UNVERIFIED_REASON}`, { ingredient, reason: UNVERIFIED_REASON, members: allergic });
        }
      }
      collect(problems, members, ingredient, a.text, a.category);
    }
    // Keyword scan only (belt and braces, §11): the title, every step, and the cited recipe's ingredient lines.
    // These never produce `unknown` and are never subject to the allergy-household unverifiable rule.
    for (const text of [meal.title, ...(meal.steps ?? []), ...(meal.ingredientLines ?? [])]) {
      collect(problems, members, text, text, null);
    }
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
