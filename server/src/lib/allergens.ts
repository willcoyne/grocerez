import { Allergen } from "../contracts/ai.js";

// The one allergen keyword table (backend/08 scan parsing and backend/10 recipe re-check). Keys are the DB `allergen` enum.
// Whole words with an optional plural, so "eggplant" is not egg and "butternut" is not butter. Compound words and
// derived foods (buttermilk, crabmeat, pesto, hummus, ...) are listed explicitly.
// ponytail: keyword match, errs toward flagging ("rice flour" -> wheat). Swap for ingredient-level data if false positives annoy users.
const WHEAT = [
  "wheat", "flour", "bread", "breadcrumb", "pasta", "spaghetti", "noodle", "couscous", "tortilla", "semolina", "cracker",
  "panko", "seitan", "durum", "farina", "bulgur", "farro", "spelt", "teriyaki", "soy sauce",
];
export const ALLERGEN_KEYWORDS: Record<Allergen, string[]> = {
  milk: [
    "milk", "dairy", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "caseinate", "lactose", "ghee",
    "parmesan", "mozzarella", "cheddar", "ricotta", "feta", "brie", "gouda", "mascarpone", "paneer", "queso", "kefir",
    "buttermilk", "buttercream", "cheesecake", "milkshake", "custard", "pudding", "alfredo", "bechamel", "tzatziki",
    "pesto", "nutella",
  ],
  eggs: ["egg", "mayonnaise", "mayo", "meringue", "aioli", "eggnog", "custard", "hollandaise", "bearnaise", "carbonara", "albumen", "albumin"],
  fish: [
    "fish", "catfish", "swordfish", "salmon", "tuna", "cod", "codfish", "pollock", "tilapia", "anchovy", "anchovies",
    "sardine", "halibut", "trout", "mackerel", "haddock", "bonito", "dashi", "surimi", "worcestershire", "caesar",
  ],
  shellfish: [
    "shellfish", "shrimp", "prawn", "crab", "crabmeat", "crabcake", "lobster", "langoustine", "crustacean", "mollusc",
    "mollusk", "clam", "mussel", "oyster", "scallop", "crawfish", "crayfish", "squid", "calamari", "octopus",
  ],
  tree_nuts: [
    "tree nut", "nut", "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "filbert", "macadamia", "pine nut",
    "brazil nut", "pesto", "nutella", "praline", "marzipan", "frangipane", "gianduja",
  ],
  peanuts: ["peanut", "groundnut", "arachis", "satay"],
  wheat: WHEAT,
  soy: ["soy", "soya", "soybean", "tofu", "tempeh", "edamame", "miso", "teriyaki", "tamari", "shoyu", "natto"],
  sesame: ["sesame", "tahini", "tahina", "hummus", "halva", "halvah"],
  gluten: ["gluten", "barley", "rye", "malt", "triticale", ...WHEAT],
};

const PORK = ["pork", "bacon", "ham", "prosciutto", "pancetta", "salami", "pepperoni", "chorizo", "lard", "gelatin", "gelatine"];
const MEAT = [
  ...PORK, "meat", "meatball", "meatloaf", "beef", "steak", "brisket", "veal", "lamb", "mutton", "venison", "bison", "sausage",
  "hot dog", "hamburger", "jerky", "pastrami", "bologna", "chicken", "turkey", "duck", "goose", "quail", "rabbit", "bone broth",
];

// Diet rules we can check in code: implied allergens plus extra keywords. Keto and low_sodium stay prompt-only.
export const DIET_EXCLUSIONS: Record<string, Allergen[]> = {
  vegan: ["milk", "eggs", "fish", "shellfish"],
  vegetarian: ["fish", "shellfish"],
  dairy_free: ["milk"],
  gluten_free: ["gluten", "wheat"],
  kosher: ["shellfish"],
};
const DIET_KEYWORDS: Record<string, string[]> = {
  vegan: [...MEAT, "honey"],
  vegetarian: MEAT,
  halal: PORK,
  kosher: PORK,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordsRe = (words: string[]) => new RegExp(`\\b(?:${words.map(escape).join("|")})(?:s|es)?\\b`, "i");
const allergenRe = Object.fromEntries(Object.entries(ALLERGEN_KEYWORDS).map(([a, w]) => [a, wordsRe(w)])) as Record<Allergen, RegExp>;
const dietRe = Object.fromEntries(Object.entries(DIET_KEYWORDS).map(([d, w]) => [d, wordsRe(w)]));

function normalize(texts: (string | null | undefined)[]): string {
  return texts
    .join("\n")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // béchamel -> bechamel
    .replace(/\b\w+[- ]free\b/gi, " ") // "dairy-free", "nut free"
    // Plant "milks"/nut butters are not dairy, but keep the plant word so peanut/soy/almond/nut still match.
    .replace(/\b(peanut|almond|cashew|sunflower|nut|apple|cocoa|coconut|oat|soy|rice) (?:butter|milk|cream|yogurt)s?\b/gi, "$1");
}

/** Allergens from `forbidden` that any of the texts mention, in enum order. */
export function findAllergens(texts: (string | null | undefined)[], forbidden: Iterable<Allergen> = Allergen.options): Allergen[] {
  const text = normalize(texts);
  const want = new Set(forbidden);
  return Allergen.options.filter((a) => want.has(a) && allergenRe[a].test(text));
}

/** Every allergen a label/ingredient text mentions (wheat also implies gluten). */
export const mapAllergens = (text: string | null | undefined): Allergen[] => (text ? findAllergens([text]) : []);

/** Diets from `diets` whose non-allergen rules (meat, pork, honey) the texts break. */
export function findDietConflicts(texts: string[], diets: Iterable<string>): string[] {
  const text = normalize(texts);
  return [...new Set(diets)].filter((d) => dietRe[d]?.test(text));
}
