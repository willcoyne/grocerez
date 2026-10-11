import type { Allergen } from "../contracts/dietary.js";

/**
 * Deterministic allergen keyword table (backend/08 step 3.4; reused by recipe checks in 10).
 * Matching is on whole words / phrases in lower-cased text.
 */
export const ALLERGEN_KEYWORDS: Record<Allergen, string[]> = {
  milk: [
    "milk", "dairy", "whey", "casein", "caseinate", "lactose", "butter", "cream", "cheese", "yogurt", "ghee", "buttermilk",
    "nutella", "pesto", "paneer", "ricotta", "parmesan", "mozzarella", "mascarpone", "queso",
  ],
  eggs: ["egg", "eggs", "albumin", "mayonnaise", "meringue", "mayo", "aioli"],
  fish: ["fish", "anchovy", "anchovies", "salmon", "tuna", "cod", "tilapia", "sardine", "sardines", "trout", "halibut", "pollock"],
  shellfish: ["shellfish", "shrimp", "prawn", "prawns", "crab", "lobster", "crayfish", "crustacean", "crustaceans", "mollusc", "molluscs", "clam", "clams", "oyster", "oysters", "mussel", "mussels", "scallop", "scallops"],
  tree_nuts: ["tree nut", "tree nuts", "almond", "almonds", "walnut", "walnuts", "cashew", "cashews", "pecan", "pecans", "pistachio", "pistachios", "hazelnut", "hazelnuts", "macadamia", "brazil nut", "brazil nuts", "nuts", "nutella", "pesto", "praline", "marzipan"],
  peanuts: ["peanut", "peanuts", "groundnut", "groundnuts", "arachis", "pb", "satay"],
  wheat: [
    "wheat", "flour", "semolina", "durum", "spelt", "farina", "couscous", "bulgur",
    "shoyu", "soy sauce", "panko", "breadcrumbs", "noodles",
  ],
  soy: ["soy", "soya", "soybean", "soybeans", "tofu", "edamame", "miso", "tempeh", "lecithin (soy)", "shoyu", "tamari", "soy sauce"],
  sesame: ["sesame", "tahini"],
  gluten: ["gluten", "wheat", "barley", "rye", "malt", "triticale", "spelt", "seitan"],
};

/** Open Food Facts tag → allergen ("en:milk", "en:nuts", …). Unknown tags (e.g. en:corn) are ignored. */
const OFF_TAGS: Record<string, Allergen> = {
  milk: "milk", eggs: "eggs", fish: "fish", crustaceans: "shellfish", molluscs: "shellfish", nuts: "tree_nuts",
  peanuts: "peanuts", soybeans: "soy", soy: "soy", "sesame-seeds": "sesame", sesame: "sesame", gluten: "gluten", wheat: "wheat",
};

/** Phrases removed before testing an allergen (they contain a keyword but aren't that allergen). */
const EXCLUDE: Partial<Record<Allergen, RegExp>> = {
  milk: /(?<![a-z])((peanut|almond|nut|cocoa|apple|shea|seed|sunflower|cashew) butter|(coconut|almond|oat|soy|soya|rice|cashew) milk|milk thistle|cream of tartar)(?![a-z])/g,
  tree_nuts: /(?<![a-z])(peanuts?|groundnuts?|nutmeg|coconuts?|donuts?|doughnuts?|butternut)(?![a-z])/g,
  wheat:
    /(?<![a-z])(rice|corn|almond|oat|coconut|potato|tapioca|chickpea|buckwheat) flour(?![a-z])|buckwheat|(?<![a-z])(gluten[- ]free|gf) (soy sauce|shoyu)(?![a-z])|(?<![a-z])(rice|glass|cellophane|bean thread|sweet potato|kelp|shirataki|zucchini) noodles(?![a-z])/g,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = Object.entries(ALLERGEN_KEYWORDS).map(([allergen, words]) => ({
  allergen: allergen as Allergen,
  re: new RegExp(`(?<![a-z])(${words.map(escape).join("|")})(?![a-z])`, "i"),
}));

/** Allergens mentioned in free text ("Contains: Wheat, Milk" / an ingredient list / a recipe ingredient). */
export function allergensInText(text: string | null | undefined): Allergen[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const found = new Set<Allergen>();
  for (const { allergen, re } of PATTERNS) {
    const exclude = EXCLUDE[allergen];
    if (re.test(exclude ? t.replace(exclude, " ") : t)) found.add(allergen);
  }
  return [...found].sort();
}

export function allergensFromOffTags(tags: string[] | null | undefined): Allergen[] {
  const out = new Set<Allergen>();
  for (const tag of tags ?? []) {
    const key = tag.toLowerCase().replace(/^[a-z]{2}:/, "");
    const a = OFF_TAGS[key];
    if (a) out.add(a);
  }
  return [...out].sort();
}
