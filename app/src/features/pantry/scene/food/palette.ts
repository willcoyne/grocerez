/**
 * Deterministic, pure colour choice per pantry item. Natural colours for fresh food, brand-ish colours
 * for a few well-known products, otherwise a pleasant palette picked by a hash of the name.
 */
import type { FoodKind, PantryItem } from "../../types";
import { normalizeFoodText, type FoodVariant } from "./foodKind";

export type FoodColors = { primary: string; secondary: string };

/** FNV-1a 32-bit hash. Stable across platforms. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Warm, cosy package colours that read well on honey wood. */
export const PACKAGE_PALETTE = [
  "#E4572E", "#F3A712", "#29335C", "#669BBC", "#7FB069", "#C1666B", "#7B4B94", "#2A9D8F",
  "#E9C46A", "#F4A261", "#5E8C61", "#D1495B", "#3D5A80", "#EE964B", "#B5838D", "#118AB2",
];

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Mix a colour toward black (amount 0..1). */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
/** Mix a colour toward white (amount 0..1). */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

type Table = [string[], string, string?][];

/** First entry whose keyword (substring on word start) appears in the text. */
function lookup(text: string, table: Table): FoodColors | null {
  for (const [words, primary, secondary] of table) {
    for (const w of words) {
      if (text === w || text.startsWith(`${w}`) || text.includes(` ${w}`)) {
        return { primary, secondary: secondary ?? "" };
      }
    }
  }
  return null;
}

// Brand-ish colours. [keywords, primary, secondary]
const BRANDS: Table = [
  [["lays"], "#FFC20E", "#D52B1E"],
  [["oreo"], "#0A2A6B", "#F5F5F5"],
  [["doritos"], "#D8232A", "#1C1C1C"],
  [["tostitos"], "#FFD34E", "#D52B1E"],
  [["pringles"], "#E2231A", "#F5F5F5"],
  [["cheetos"], "#F58220", "#1F7A3E"],
  [["honey nut cheerio"], "#F6A623", "#7A4A1E"],
  [["cheerio"], "#FFD100", "#C8102E"],
  [["frosted flake"], "#1E66B4", "#F58220"],
  [["cheez it", "cheezit"], "#E31837", "#FFD100"],
  [["goldfish"], "#F28C28", "#1D5FA8"],
  [["ritz"], "#C8102E", "#E8B04A"],
  [["chips ahoy"], "#0055A5", "#E31837"],
  [["snickers"], "#4E2A1E", "#2A62B0"],
  [["reeses"], "#F47920", "#4E2A1E"],
  [["m and m"], "#5C3317", "#FFD200"],
  [["diet coke"], "#C9CED6", "#E2231A"],
  [["coca cola", "coke"], "#E2231A", "#F5F5F5"],
  [["pepsi"], "#004B93", "#E2231A"],
  [["sprite"], "#00A651", "#FFD200"],
  [["dr pepper"], "#7A1F2B", "#F5F5F5"],
  [["gatorade"], "#F57F20", "#1F7A3E"],
  [["ben and jerry"], "#F2F2EA", "#3A7DC1"],
];

// Contents colour for jars/bottles/cartons.
const CONTENTS: Table = [
  [["peanut butter", "almond butter", "cashew butter"], "#B07A3F"],
  [["strawberry jam", "strawberry jelly"], "#C2185B"],
  [["jam", "jelly", "preserves", "marmalade"], "#8E1F3A"],
  [["salsa"], "#C8452C"],
  [["honey"], "#E9A92A"],
  [["mayo", "mayonnaise", "ranch"], "#F5EED8"],
  [["pickle", "relish"], "#7A8F3A"],
  [["nutella"], "#4A2C1D"],
  [["hummus"], "#D9BC8C"],
  [["tahini"], "#CDAE7E"],
  [["tomato", "pasta sauce", "marinara", "ketchup"], "#C0392B"],
  [["yogurt", "yoghurt", "sour cream", "cream cheese", "cottage"], "#F7F3EA"],
  [["coffee"], "#4B3020"],
  [["salt"], "#F3F3F3"],
  [["black pepper", "pepper", "peppercorn"], "#3B3B3B"],
  [["cinnamon", "paprika", "cumin", "spice"], "#8B4A2B"],
  [["molasses", "soy sauce"], "#3A1F12"],
  [["olive oil", "olive"], "#8F9A3A"],
  [["oil"], "#D9B44A"],
  [["mustard"], "#F2C230"],
  [["hot sauce", "sriracha"], "#D84315"],
  [["sparkling", "seltzer"], "#A8DDEB"],
  [["water"], "#BFE3F2"],
  [["wine"], "#6D1A36"],
  [["beer"], "#9C6A1E"],
  [["orange juice"], "#F7A21B"],
  [["apple juice"], "#E8B44A"],
  [["lemonade"], "#F4E27A"],
  [["maple syrup", "syrup"], "#A0522D"],
  [["vinegar"], "#E6D8A8"],
  [["kombucha", "iced tea"], "#B5793A"],
  [["vanilla"], "#5A3A22"],
];

// Cartons: [primary carton colour, secondary print colour].
const CARTONS: Table = [
  [["chocolate milk"], "#F7F2EA", "#6B3E1E"],
  [["oat milk"], "#F3E6CC", "#8D6E3F"],
  [["almond milk"], "#EFE1C6", "#6D4C41"],
  [["soy milk"], "#F3F1E6", "#2E7D32"],
  [["cream", "half and half", "creamer"], "#F7F7F2", "#C2185B"],
  [["broth", "stock"], "#F2E8D5", "#E0A030"],
  [["buttermilk"], "#F7F7F2", "#E08A2B"],
  [["milk"], "#F7F7F2", "#2B6CB0"],
];

const FRUIT: Table = [
  [["green apple", "granny smith"], "#8BC34A", "#4CAF50"],
  [["apple"], "#D9353B", "#4CAF50"],
  [["banana", "plantain"], "#F5D33F", "#6B4F2A"],
  [["orange", "clementine", "mandarin", "tangerine"], "#F7941D", "#4CAF50"],
  [["grapefruit"], "#F28B66", "#4CAF50"],
  [["lemon"], "#F7E04A", "#4CAF50"],
  [["lime"], "#7CB342", "#4CAF50"],
  [["grape"], "#7B3F8C", "#6BAF5B"],
  [["strawberr"], "#E53945", "#6BAF5B"],
  [["blueberr"], "#3F51B5", "#6BAF5B"],
  [["raspberr"], "#D6336C", "#6BAF5B"],
  [["blackberr"], "#3B2448", "#6BAF5B"],
  [["cherr"], "#B71C1C", "#6BAF5B"],
  [["pear"], "#C5D86D", "#4CAF50"],
  [["peach", "nectarine", "apricot"], "#FFAA80", "#4CAF50"],
  [["plum"], "#7E3A6B", "#4CAF50"],
  [["mango"], "#FFB347", "#4CAF50"],
  [["pineapple"], "#E8B64A", "#3E8E41"],
  [["watermelon"], "#3E8E41", "#2E5E2F"],
  [["melon", "cantaloupe", "honeydew"], "#E9C67A", "#8D9A50"],
  [["kiwi"], "#8D6E3F", "#4CAF50"],
  [["avocado"], "#4E6B2E", "#3E5A26"],
  [["pomegranate"], "#B3243A", "#4CAF50"],
];

const VEG: Table = [
  [["carrot", "parsnip"], "#F57C00", "#4CAF50"],
  [["tomato"], "#E53935", "#3E8E41"],
  [["green pepper", "green bell"], "#3E8E41", "#2E6B30"],
  [["yellow pepper", "yellow bell"], "#F9C80E", "#3E8E41"],
  [["jalapeno", "chili"], "#3E8E41", "#2E6B30"],
  [["pepper"], "#D32F2F", "#3E8E41"],
  [["red onion"], "#8E3B5E", "#A8875A"],
  [["green onion", "scallion", "spring onion"], "#7CB342", "#F1E9DA"],
  [["onion", "shallot"], "#C9955B", "#A8875A"],
  [["garlic"], "#F1E9DA", "#A8875A"],
  [["sweet potato", "yam"], "#C0603A", "#8A5A3A"],
  [["potato"], "#B98B5A", "#8A6A44"],
  [["cucumber"], "#3C7A3E", "#2E5E2F"],
  [["zucchini"], "#4E8B3A", "#3A6A2A"],
  [["eggplant"], "#5B2C6F", "#3E8E41"],
  [["corn"], "#F4D35E", "#8BC34A"],
  [["broccoli"], "#3E7D35", "#8BBF5A"],
  [["cauliflower"], "#F3EBD7", "#9CCB6A"],
  [["mushroom"], "#C8B49A", "#E9DCC7"],
  [["ginger"], "#D7B377", "#B08850"],
  [["asparagus"], "#6A9A3A", "#8BBF5A"],
  [["green bean", "pea"], "#5DA03E", "#3E7D35"],
  [["beet"], "#8E1E46", "#4CAF50"],
  [["radish"], "#D84368", "#4CAF50"],
  [["pumpkin", "squash"], "#E68A2E", "#6B8E23"],
];

const LEAFY: Table = [
  [["red cabbage"], "#6B2C5E", "#8E4A7E"],
  [["iceberg", "lettuce"], "#8BC34A", "#B5D98A"],
  [["romaine"], "#6FAE45", "#A5D07A"],
  [["cabbage"], "#A5C88A", "#C8E0B2"],
  [["spinach"], "#2E6B30", "#B5835A"],
  [["kale"], "#2F5D3A", "#B5835A"],
  [["celery"], "#9CCB6A", "#B5835A"],
];

const MEAT: Table = [
  [["bacon"], "#D9776B", "#FFD54F"],
  [["pepperoni", "salami", "chorizo"], "#A33A2E", "#FFD54F"],
  [["sausage", "hot dog"], "#B5543C", "#FFD54F"],
  [["chicken", "turkey"], "#F2B8A0", "#FFD54F"],
  [["ham", "prosciutto"], "#E88F8F", "#FFD54F"],
  [["pork"], "#E9A091", "#FFD54F"],
];

const FISH: Table = [
  [["salmon"], "#F08A5D"],
  [["shrimp", "prawn"], "#F59E7C"],
  [["tuna", "ahi"], "#B8434A"],
  [["crab", "lobster"], "#E0563B"],
];

const CHEESE: Table = [
  [["mozzarella", "feta", "ricotta", "string"], "#F6F1E1"],
  [["parmesan"], "#EAD18A"],
  [["cheddar"], "#F29E2E"],
  [["brie", "camembert"], "#F3E7C9"],
  [["swiss"], "#F7D96B"],
];

const BREAD: Table = [
  [["whole wheat", "rye", "wheat"], "#A86B3C"],
  [["bagel"], "#C98B4E"],
  [["tortilla", "wrap"], "#EAD2A4"],
  [["pita", "naan", "flatbread"], "#E3C08A"],
  [["croissant"], "#D9973F"],
];

function hashed(seed: string): FoodColors {
  const h = hashString(seed);
  const n = PACKAGE_PALETTE.length;
  const a = h % n;
  // pick a different secondary, offset so pairs vary
  const b = (a + 3 + ((h >>> 8) % (n - 4))) % n;
  return { primary: PACKAGE_PALETTE[a], secondary: PACKAGE_PALETTE[b === a ? (a + 1) % n : b] };
}

const withSecondary = (c: FoodColors | null, fallback: string): FoodColors | null =>
  c ? { primary: c.primary, secondary: c.secondary || fallback } : null;

/** Colours for an item's procedural mesh. Pure and deterministic. */
export function foodColorsFor(
  item: Pick<PantryItem, "name" | "brand">,
  kind: FoodKind,
  variant: FoodVariant = "default",
): FoodColors {
  const name = normalizeFoodText(item.name);
  const text = `${name} ${normalizeFoodText(item.brand)}`.trim();
  const base = hashed(name || "item");

  switch (kind) {
    case "fruit":
      return withSecondary(lookup(name, FRUIT), "#4CAF50") ?? { primary: "#E0703A", secondary: "#4CAF50" };
    case "veg":
      return withSecondary(lookup(name, VEG), "#4CAF50") ?? { primary: "#6A9A3A", secondary: "#4CAF50" };
    case "leafy": {
      const c = lookup(name, LEAFY) ?? { primary: "#4C9A4C", secondary: "" };
      return { primary: c.primary, secondary: c.secondary || (variant === "head" ? lighten(c.primary, 0.3) : "#B5835A") };
    }
    case "meat":
      return withSecondary(lookup(name, MEAT), "#FFD54F") ?? { primary: "#B23A3A", secondary: "#FFD54F" };
    case "fish": {
      const p = lookup(name, FISH)?.primary ?? "#8FA9BF";
      return { primary: p, secondary: darken(p, 0.25) };
    }
    case "cheese": {
      const p = lookup(name, CHEESE)?.primary ?? "#F6C744";
      return { primary: p, secondary: darken(p, 0.18) };
    }
    case "bread": {
      const p = lookup(name, BREAD)?.primary ?? "#D09A5B";
      return { primary: p, secondary: darken(p, 0.3) };
    }
    case "eggs":
      return { primary: "#C9D6DF", secondary: "#9FB3C2" };
    case "carton":
      return withSecondary(lookup(text, BRANDS) ?? lookup(name, CARTONS), base.secondary) ?? base;
    case "jar":
    case "bottle": {
      const brand = lookup(text, BRANDS);
      if (brand) return withSecondary(brand, base.secondary)!;
      const contents = lookup(name, CONTENTS);
      return contents ? { primary: contents.primary, secondary: base.primary } : base;
    }
    default:
      return withSecondary(lookup(text, BRANDS), base.secondary) ?? base;
  }
}
