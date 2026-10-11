import { prisma } from "../../db.js";
import type { SafetyCheckBody, SafetyCheckResponse } from "../../contracts/agent.js";
import { DIETS, type Allergen } from "../../contracts/dietary.js";
import { allergensInText } from "../../lib/allergens.js";
import { conflicts } from "../../lib/diets.js";
import { itemsService } from "../items/service.js";
import { agentRepo } from "./repo.js";

/** One keyword per allergen that allergensInText() recognises, used to fold catalog allergens into the checked text. */
const ALLERGEN_WORD: Record<Allergen, string> = {
  milk: "milk", eggs: "egg", fish: "fish", shellfish: "shellfish", tree_nuts: "tree nut",
  peanuts: "peanut", wheat: "wheat", soy: "soy", sesame: "sesame", gluten: "gluten",
};

type Meal = SafetyCheckBody["meals"][number];
type Analysis = { text: string; unknown: boolean };

/**
 * Catalog lookup for one ingredient: exact/suggested match → its defaultAllergens. The text checked is the ingredient
 * plus one keyword per catalog allergen ("; "-separated so EXCLUDE phrases like "almond milk" can't be formed across them).
 * Unknown = no catalog match AND no allergen/diet keyword in the ingredient itself.
 */
async function analyse(ingredient: string): Promise<Analysis> {
  const res = await itemsService.search(ingredient, prisma).catch(() => null);
  const hit = res && res.match !== "none" ? res.results[0] : null;
  const catalog = hit?.defaultAllergens ?? [];
  const text = [ingredient, ...catalog.map((a) => ALLERGEN_WORD[a])].join("; ");
  const keywordHit = allergensInText(ingredient).length > 0 || conflicts(ingredient, [...DIETS], []).length > 0;
  return { text, unknown: !hit && !keywordHit };
}

/**
 * THE meal safety check (challenge 01 §4.3), used by POST /agent/safety-check and by apply.
 * Pure function of DB state: every ingredient is checked against EACH member's allergens and diets (lib/diets conflicts()),
 * so problems name the members they affect. Known conflicts fail the meal; unknown ingredients don't.
 */
async function check(groupId: string, meals: Meal[]): Promise<SafetyCheckResponse> {
  const members = (await agentRepo.members(groupId)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const cache = new Map<string, Promise<Analysis>>();
  const lookup = (ingredient: string) => {
    const key = ingredient.trim().toLowerCase();
    if (!cache.has(key)) cache.set(key, analyse(ingredient));
    return cache.get(key)!;
  };

  const out: SafetyCheckResponse["meals"] = [];
  for (const meal of meals) {
    const problems = new Map<string, { ingredient: string; reason: string; members: string[] }>();
    const unknown: string[] = [];
    for (const ingredient of meal.ingredients) {
      const a = await lookup(ingredient);
      if (a.unknown && !unknown.includes(ingredient)) unknown.push(ingredient);
      for (const m of members) {
        for (const reason of conflicts(a.text, m.diets, m.allergens)) {
          const key = `${ingredient}\u0000${reason}`;
          const p = problems.get(key) ?? { ingredient, reason, members: [] };
          if (!p.members.includes(m.displayName)) p.members.push(m.displayName);
          problems.set(key, p);
        }
      }
    }
    out.push({ title: meal.title, passes: problems.size === 0, problems: [...problems.values()], unknown });
  }
  return { meals: out };
}

export const safety = { check };
