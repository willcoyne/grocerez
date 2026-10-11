/**
 * Pure keyword + category heuristics that pick a procedural mesh for a pantry item.
 * No three.js imports here so it stays cheap to unit-test.
 */
import type { FoodKind, PantryItem } from "../../types";

type KindInput = Pick<PantryItem, "name" | "brand" | "category" | "location">;

/** Lowercase, strip accents/apostrophes, collapse punctuation to single spaces ("Lay's" -> "lays"). */
export function normalizeFoodText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Keyword syntax: plain words/phrases match on word boundaries with an optional plural (s/es);
 * a trailing `*` makes it a prefix match ("berr*" matches berry/berries).
 */
function compile(words: string[]): RegExp {
  const parts = words.map((w) => {
    const n = normalizeFoodText(w.replace(/\*$/, ""));
    return w.endsWith("*") ? `${esc(n)}[a-z]*` : `${esc(n)}(?:s|es)?`;
  });
  return new RegExp(`(?:^| )(?:${parts.join("|")})(?= |$)`);
}

type Rule = [FoodKind, RegExp];
const rule = (kind: FoodKind, words: string[]): Rule => [kind, compile(words)];

/**
 * Ordered: the first matching rule wins. Specific phrases and brands come first so that
 * "Honey Nut Cheerios" is a box (not a honey jar), "Orange Juice" a bottle (not fruit), etc.
 */
const RULES: Rule[] = [
  // --- specific phrases / brands that would otherwise hit a broader rule ---
  rule("icecream", ["ice cream", "frozen yogurt", "froyo", "gelato", "sorbet", "popsicle", "ben and jerry*", "haagen*"]),
  rule("frozenbox", ["fish stick", "fish finger", "tv dinner", "lean cuisine"]),
  rule("box", [
    "chips ahoy", "cheez it", "cheezit", "goldfish", "ritz", "oreo", "wheat thins", "graham*", "pop tart", "granola bar",
    "cheerio", "frosted flake", "corn flake", "mac and cheese", "macaroni", "egg noodle", "pancake mix", "cake mix",
    "baking soda", "rice krispies", "triscuit",
  ]),
  rule("chips", [
    "tortilla chip", "rice cake", "beef jerky", "jerky", "fruit snack", "trail mix", "reeses", "m and m", "mandms",
    "snickers", "kit kat", "twix", "skittles", "gummy", "gummies", "candy", "swedish fish",
  ]),
  rule("can", ["pringles", "canned", "baking powder", "bread crumb", "breadcrumb", "coconut milk", "energy drink", "soup", "red bull", "monster energy"]),
  rule("bottle", [
    "soy sauce", "hot sauce", "bbq sauce", "barbecue sauce", "fish sauce", "worcestershire", "sriracha", "maple syrup",
    "vanilla extract", "olive oil", "iced tea", "orange juice", "apple juice", "dr pepper", "root beer", "coconut water",
    "salad dressing",
  ]),
  rule("jar", [
    "peanut butter", "almond butter", "cashew butter", "nutella", "apple sauce", "applesauce", "cottage cheese",
    "cream cheese", "sour cream", "tomato sauce", "pasta sauce", "marinara", "tomato paste", "black pepper",
    "pepper flake", "peppercorn",
  ]),
  rule("carton", [
    "chocolate milk", "oat milk", "almond milk", "soy milk", "rice milk", "half and half", "heavy cream", "whipping cream",
    "coffee creamer", "creamer", "buttermilk", "eggnog", "broth", "stock",
  ]),
  rule("veg", ["green bean", "green onion", "spring onion", "scallion", "corn on the cob", "sweet potato", "bell pepper", "jalapeno", "eggplant", "chili pepper"]),
  rule("fish", ["tuna steak", "ahi"]),
  rule("cheese", ["string cheese"]),
  rule("bread", ["hot dog bun", "hamburger bun", "english muffin"]),

  // --- broad keyword groups ---
  rule("frozenbox", ["frozen", "pizza", "waffle", "nugget", "french fries", "fries", "tater tot", "burrito", "dumpling", "pierogi", "ice"]),
  rule("chips", [
    "chip", "crisp", "lays", "doritos", "tostitos", "cheetos", "fritos", "ruffles", "funyuns", "popcorn", "pretzel",
    "almonds", "peanuts", "cashews", "pistachio", "nuts", "chocolate",
  ]),
  rule("box", [
    "cereal", "cracker", "cookie", "biscotti", "pasta", "spaghetti", "penne", "linguine", "fettuccine", "lasagna",
    "noodle", "ramen", "granola", "oat", "oatmeal", "rice", "quinoa", "couscous", "lentil", "flour", "sugar", "tea",
    "butter", "mix", "stuffing", "bar",
  ]),
  rule("can", ["can", "beans", "chickpea", "tuna", "sardine", "spam", "chili", "anchov*"]),
  rule("jar", [
    "jam", "jelly", "preserves", "marmalade", "salsa", "sauce", "honey", "pickle", "mayo", "mayonnaise", "spread",
    "pesto", "olive", "yogurt", "yoghurt", "hummus", "tahini", "molasses", "salt", "spice", "cinnamon", "paprika",
    "cumin", "oregano", "nutmeg", "coffee", "relish", "dip", "ghee",
  ]),
  rule("bottle", [
    "soda", "cola", "coke", "pepsi", "sprite", "fanta", "gatorade", "powerade", "lemonade", "juice", "oil", "vinegar",
    "ketchup", "mustard", "dressing", "ranch", "syrup", "water", "seltzer", "wine", "beer", "kombucha", "extract",
    "smoothie",
  ]),
  rule("carton", ["milk", "cream"]),
  rule("eggs", ["egg"]),
  rule("cheese", ["cheese", "cheddar", "mozzarella", "parmesan", "brie", "gouda", "swiss", "feta", "provolone", "camembert", "halloumi", "ricotta"]),
  rule("meat", [
    "chicken", "beef", "pork", "bacon", "ham", "turkey", "sausage", "steak", "lamb", "hot dog", "salami", "pepperoni",
    "prosciutto", "deli", "rib", "mince", "ground", "brisket", "veal", "meatball", "chorizo",
  ]),
  rule("fish", ["salmon", "fish", "cod", "tilapia", "shrimp", "prawn", "trout", "halibut", "crab", "lobster", "scallop", "mackerel", "seafood"]),
  rule("bread", ["bread", "bagel", "loaf", "baguette", "bun", "roll", "tortilla", "croissant", "muffin", "pita", "naan", "brioche", "sourdough", "donut", "doughnut", "wrap", "flatbread", "biscuit"]),
  rule("fruit", [
    "apple", "banana", "plantain", "orange", "berr*", "grape", "lemon", "lime", "pear", "peach", "plum", "mango",
    "pineapple", "strawberr*", "blueberr*", "raspberr*", "blackberr*", "cranberr*", "kiwi", "melon", "watermelon", "cantaloupe", "honeydew", "cherr*", "avocado", "clementine", "mandarin",
    "tangerine", "nectarine", "apricot", "pomegranate", "fig", "papaya", "grapefruit",
  ]),
  rule("veg", [
    "carrot", "tomato", "pepper", "onion", "garlic", "potato", "cucumber", "zucchini", "broccoli", "cauliflower", "corn",
    "mushroom", "squash", "pumpkin", "radish", "beet", "ginger", "shallot", "yam", "asparagus", "pea", "leek",
    "parsnip", "turnip", "artichoke", "brussels sprout",
  ]),
  rule("leafy", [
    "lettuce", "spinach", "kale", "arugula", "rocket", "romaine", "iceberg", "cabbage", "chard", "greens", "salad",
    "herb", "cilantro", "parsley", "basil", "mint", "dill", "bok choy", "celery", "collard", "spring mix", "watercress",
  ]),
];

const CATEGORY_KIND: Record<string, FoodKind> = {
  produce: "veg",
  bakery: "bread",
  meat: "meat",
  seafood: "fish",
  dairy: "carton",
  frozen: "frozenbox",
  pantry: "box",
  snacks: "chips",
  beverages: "bottle",
};

function matchText(text: string): FoodKind | null {
  if (!text) return null;
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return null;
}

/** Pick the procedural mesh for a pantry item: name, then brand, then category, then storage location. */
export function foodKindFor(item: KindInput): FoodKind {
  const byName = matchText(normalizeFoodText(item.name));
  if (byName) return byName;
  const byBrand = matchText(normalizeFoodText(item.brand));
  if (byBrand) return byBrand;
  const cat = normalizeFoodText(item.category);
  if (cat && CATEGORY_KIND[cat]) return CATEGORY_KIND[cat];
  if (item.location === "freezer") return "frozenbox";
  return "generic";
}

/** Shape variants within a kind (geometry differs, e.g. bananas vs apples). */
export type FoodVariant =
  | "default"
  | "banana"
  | "berries"
  | "melon"
  | "pineapple"
  | "carrot"
  | "long"
  | "floret"
  | "head"
  | "bagel"
  | "flat"
  | "bun";

const VARIANTS: Partial<Record<FoodKind, [FoodVariant, RegExp][]>> = {
  fruit: [
    ["banana", compile(["banana", "plantain"])],
    ["pineapple", compile(["pineapple"])],
    ["melon", compile(["watermelon", "melon", "cantaloupe", "honeydew"])],
    ["berries", compile(["berr*", "strawberr*", "blueberr*", "raspberr*", "blackberr*", "cranberr*", "grape", "cherr*"])],
  ],
  veg: [
    ["carrot", compile(["carrot", "parsnip"])],
    ["floret", compile(["broccoli", "cauliflower"])],
    ["long", compile(["cucumber", "zucchini", "eggplant", "corn", "asparagus", "green bean", "leek", "green onion", "scallion"])],
  ],
  leafy: [["head", compile(["lettuce", "cabbage", "romaine", "iceberg"])]],
  bread: [
    ["bagel", compile(["bagel", "donut", "doughnut"])],
    ["flat", compile(["tortilla", "pita", "naan", "wrap", "flatbread"])],
    ["bun", compile(["bun", "roll", "muffin", "croissant", "biscuit"])],
  ],
};

export function foodVariantFor(item: Pick<PantryItem, "name">, kind: FoodKind): FoodVariant {
  const list = VARIANTS[kind];
  if (!list) return "default";
  const text = normalizeFoodText(item.name);
  for (const [variant, re] of list) if (re.test(text)) return variant;
  return "default";
}

/** Max visible characters on the name tag. */
export const LABEL_MAX_CHARS = 14;

/** Truncate a name for the 3D tag ("Honey Nut Cheerios" -> "Honey Nut Che..."). */
export function truncateLabel(name: string, max = LABEL_MAX_CHARS): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 2).trimEnd()}..`;
}
