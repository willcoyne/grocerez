import type { Allergen } from "../../contracts/ai.js";

// Deterministic allergen keyword table. backend/08 should import this rather than write a second one.
// ponytail: keyword match, errs toward flagging ("coconut milk" -> milk). Swap for ingredient-level data if false positives annoy users.
const WHEAT = ["wheat", "flour", "bread", "breadcrumb", "pasta", "spaghetti", "noodle", "couscous", "tortilla", "semolina", "cracker"];
export const ALLERGEN_KEYWORDS: Record<Allergen, string[]> = {
  milk: ["milk", "dairy", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee", "parmesan", "mozzarella", "cheddar", "ricotta"],
  eggs: ["egg", "mayonnaise", "mayo", "meringue"],
  fish: ["fish", "salmon", "tuna", "cod", "tilapia", "anchovy", "anchovies", "sardine", "halibut", "trout"],
  shellfish: ["shellfish", "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "crawfish"],
  tree_nuts: ["tree nut", "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "pine nut"],
  peanuts: ["peanut"],
  wheat: WHEAT,
  soy: ["soy", "soya", "tofu", "tempeh", "edamame", "miso"],
  sesame: ["sesame", "tahini"],
  gluten: ["gluten", "barley", "rye", ...WHEAT],
};

// Diets that imply allergen-style exclusions we can check deterministically. Other diet rules are prompt-only.
export const DIET_EXCLUSIONS: Record<string, Allergen[]> = {
  vegan: ["milk", "eggs", "fish", "shellfish"],
  vegetarian: ["fish", "shellfish"],
  dairy_free: ["milk"],
  gluten_free: ["gluten", "wheat"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.fromEntries(
  Object.entries(ALLERGEN_KEYWORDS).map(([a, words]) => [
    a,
    new RegExp(`\\b(?:${words.map(escape).join("|")})(?:s|es)?\\b`, "i"),
  ]),
) as Record<Allergen, RegExp>;

/** Allergens from `forbidden` that any of the texts mention. "dairy-free" / "nut free" phrases are ignored. */
export function findAllergens(texts: string[], forbidden: Iterable<Allergen>): Allergen[] {
  const text = texts
    .join("\n")
    .replace(/\b\w+[- ]free\b/gi, " ")
    // Plant "milks"/nut butters are not dairy, but keep the plant word so peanut/soy/almond still match.
    .replace(/\b(peanut|almond|cashew|sunflower|nut|apple|cocoa|coconut|oat|soy|rice) (?:butter|milk|cream|yogurt)s?\b/gi, "$1");
  return [...new Set(forbidden)].filter((a) => patterns[a].test(text));
}
