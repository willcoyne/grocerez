import type { Allergen, Diet } from "../contracts/dietary.js";
import { allergensInText } from "./allergens.js";

// Plural-tolerant ("Chickens", "Steaks", "Meatballs", "Hot Dogs"): a plural must not slip past a vegetarian.
const MEAT =
  /(?<![a-z])(beef|pork|bacon|hams?|chickens?|turkeys?|lambs?|veal|sausages?|pepperonis?|salamis?|prosciutto|chorizos?|meats?|meatballs?|meatloaf|steaks?|ground beef|gelatin|lard|ducks?|venison|hot ?dogs?|jerky|brisket|ribs)(?![a-z])/i;
const NOT_VEGAN = /(?<![a-z])(honey|gelatin)(?![a-z])/i;
const NOT_KETO = /(?<![a-z])(sugar|rice|pasta|bread|potato(es)?|flour|noodles?|tortillas?)(?![a-z])/i;

/**
 * Deterministic check of one recipe's text against the group's combined diets and allergens.
 * Returns the reasons it conflicts (empty = allowed). Halal/kosher/low_sodium aren't keyword-checkable beyond
 * pork for halal/kosher; they're enforced through the prompt.
 */
export function conflicts(text: string, diets: Diet[], allergens: Allergen[]): string[] {
  const found = new Set(allergensInText(text));
  const out: string[] = [];
  for (const a of allergens) if (found.has(a)) out.push(`contains ${a}`);
  const has = (re: RegExp) => re.test(text);
  for (const d of diets) {
    if (d === "vegan" && (has(MEAT) || has(NOT_VEGAN) || ["milk", "eggs", "fish", "shellfish"].some((x) => found.has(x as Allergen)))) out.push("not vegan");
    if (d === "vegetarian" && (has(MEAT) || found.has("fish") || found.has("shellfish"))) out.push("not vegetarian");
    if (d === "pescatarian" && has(MEAT)) out.push("not pescatarian");
    if (d === "dairy_free" && found.has("milk")) out.push("not dairy-free");
    if (d === "gluten_free" && (found.has("gluten") || found.has("wheat"))) out.push("not gluten-free");
    if ((d === "halal" || d === "kosher") && /(?<![a-z])(pork|bacon|ham|lard|prosciutto)(?![a-z])/i.test(text)) out.push(`not ${d}`);
    if (d === "kosher" && found.has("shellfish")) out.push("not kosher");
    if (d === "keto" && has(NOT_KETO)) out.push("not keto");
  }
  return out;
}
