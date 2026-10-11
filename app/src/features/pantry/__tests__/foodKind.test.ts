import type { FoodKind, PantryItem } from "../types";
import { foodKindFor, foodVariantFor, normalizeFoodText, truncateLabel } from "../scene/food/foodKind";
import { darken, foodColorsFor, hashString, lighten, PACKAGE_PALETTE } from "../scene/food/palette";

type KindInput = Pick<PantryItem, "name" | "brand" | "category" | "location">;
const it_ = (name: string, extra: Partial<KindInput> = {}): KindInput => ({ name, brand: null, category: null, location: null, ...extra });

describe("normalizeFoodText", () => {
  it("lowercases, strips apostrophes/accents and punctuation", () => {
    expect(normalizeFoodText("Lay's")).toBe("lays");
    expect(normalizeFoodText("Jalapeños")).toBe("jalapenos");
    expect(normalizeFoodText("Cheez-Its")).toBe("cheez its");
    expect(normalizeFoodText("M&M's")).toBe("m and ms");
    expect(normalizeFoodText(null)).toBe("");
  });
});

describe("foodKindFor", () => {
  const cases: [string, FoodKind][] = [
    // chips
    ["Lay's", "chips"], ["Doritos Cool Ranch", "chips"], ["Tostitos", "chips"], ["Potato Chips", "chips"],
    ["Tortilla Chips", "chips"], ["Pretzels", "chips"], ["Popcorn", "chips"], ["Beef Jerky", "chips"],
    ["Reese's Peanut Butter Cups", "chips"], ["M&M's", "chips"], ["Trail Mix", "chips"], ["Rice Cakes", "chips"],
    // box
    ["Cheerios", "box"], ["Honey Nut Cheerios", "box"], ["Oreos", "box"], ["Ritz Crackers", "box"], ["Cookies", "box"],
    ["Spaghetti", "box"], ["Macaroni and Cheese", "box"], ["Chips Ahoy", "box"], ["Goldfish Crackers", "box"],
    ["Cheez-Its", "box"], ["Baking Soda", "box"], ["Granola Bars", "box"],
    // can
    ["Canned Soup", "can"], ["Chicken Noodle Soup", "can"], ["Black Beans", "can"], ["Canned Tuna", "can"],
    ["Pringles", "can"], ["Energy Drinks", "can"], ["Bread Crumbs", "can"], ["Chickpeas", "can"],
    // jar
    ["Peanut Butter", "jar"], ["Strawberry Jam", "jar"], ["Salsa", "jar"], ["Pasta Sauce", "jar"], ["Tomato Sauce", "jar"],
    ["Honey", "jar"], ["Mayonnaise", "jar"], ["Greek Yogurt", "jar"], ["Black Pepper", "jar"], ["Cottage Cheese", "jar"],
    // bottle
    ["Coca-Cola", "bottle"], ["Diet Coke", "bottle"], ["Orange Juice", "bottle"], ["Apple Juice", "bottle"],
    ["Olive Oil", "bottle"], ["Ketchup", "bottle"], ["Soy Sauce", "bottle"], ["Hot Sauce", "bottle"], ["Dr Pepper", "bottle"],
    ["Lemonade", "bottle"], ["Iced Tea", "bottle"], ["Maple Syrup", "bottle"], ["Sparkling Water", "bottle"],
    // carton
    ["Milk", "carton"], ["Oat Milk", "carton"], ["Almond Milk", "carton"], ["Heavy Cream", "carton"],
    ["Half and Half", "carton"], ["Coffee Creamer", "carton"], ["Chicken Broth", "carton"],
    // eggs / cheese / meat / fish
    ["Eggs", "eggs"], ["Large Brown Egg", "eggs"], ["Cheddar Cheese", "cheese"], ["String Cheese", "cheese"], ["Mozzarella", "cheese"],
    ["Chicken Breast", "meat"], ["Ground Beef", "meat"], ["Bacon", "meat"], ["Hot Dogs", "meat"], ["Pepperoni", "meat"],
    ["Salmon", "fish"], ["Shrimp", "fish"], ["Tuna Steak", "fish"],
    // bread
    ["Bread", "bread"], ["Whole Wheat Bread", "bread"], ["Bagels", "bread"], ["Tortillas", "bread"], ["Hot Dog Buns", "bread"],
    ["English Muffins", "bread"],
    // fruit / veg / leafy
    ["Apples", "fruit"], ["Bananas", "fruit"], ["Oranges", "fruit"], ["Strawberries", "fruit"], ["Blueberries", "fruit"],
    ["Grapes", "fruit"], ["Avocados", "fruit"], ["Mangoes", "fruit"],
    ["Carrots", "veg"], ["Tomatoes", "veg"], ["Bell Peppers", "veg"], ["Onions", "veg"], ["Sweet Potatoes", "veg"],
    ["Green Beans", "veg"], ["Eggplant", "veg"], ["Corn on the Cob", "veg"], ["Jalapeños", "veg"],
    ["Lettuce", "leafy"], ["Spinach", "leafy"], ["Kale", "leafy"], ["Celery", "leafy"], ["Cilantro", "leafy"],
    // frozen
    ["Ice Cream", "icecream"], ["Ben & Jerry's Cookie Dough", "icecream"], ["Frozen Pizza", "frozenbox"],
    ["Frozen Peas", "frozenbox"], ["Chicken Nuggets", "frozenbox"], ["Fish Sticks", "frozenbox"], ["Frozen Berries", "frozenbox"],
  ];
  it.each(cases)("%s -> %s", (name, kind) => {
    expect(foodKindFor(it_(name))).toBe(kind);
  });

  it("falls back to the brand when the name says nothing", () => {
    expect(foodKindFor(it_("Classic", { brand: "Lay's" }))).toBe("chips");
    expect(foodKindFor(it_("Original", { brand: "Oreo" }))).toBe("box");
  });

  it("falls back to category, then freezer location, then generic", () => {
    expect(foodKindFor(it_("Mystery Thing", { category: "beverages" }))).toBe("bottle");
    expect(foodKindFor(it_("Mystery Thing", { category: "bakery" }))).toBe("bread");
    expect(foodKindFor(it_("Mystery Thing", { category: "snacks" }))).toBe("chips");
    expect(foodKindFor(it_("Mystery Thing", { category: "dairy" }))).toBe("carton");
    expect(foodKindFor(it_("Mystery Thing", { location: "freezer" }))).toBe("frozenbox");
    expect(foodKindFor(it_("Paper Towels", { category: "household" }))).toBe("generic");
    expect(foodKindFor(it_(""))).toBe("generic");
  });

  it("name wins over category", () => {
    expect(foodKindFor(it_("Frozen Burritos", { category: "pantry" }))).toBe("frozenbox");
    expect(foodKindFor(it_("Peanuts", { category: "pantry" }))).toBe("chips");
  });

  it("does not match keywords inside other words", () => {
    expect(foodKindFor(it_("Rice"))).toBe("box"); // not "ice"
    expect(foodKindFor(it_("Birthday Candles", { category: "other" }))).toBe("generic"); // not "can"
    expect(foodKindFor(it_("Grapefruit"))).toBe("fruit");
  });
});

describe("foodVariantFor", () => {
  const v = (name: string) => foodVariantFor({ name }, foodKindFor(it_(name)));
  it("picks shape variants", () => {
    expect(v("Bananas")).toBe("banana");
    expect(v("Strawberries")).toBe("berries");
    expect(v("Grapes")).toBe("berries");
    expect(v("Grapefruit")).toBe("default");
    expect(v("Watermelon")).toBe("melon");
    expect(v("Pineapple")).toBe("pineapple");
    expect(v("Apples")).toBe("default");
    expect(v("Carrots")).toBe("carrot");
    expect(v("Cucumbers")).toBe("long");
    expect(v("Broccoli")).toBe("floret");
    expect(v("Tomatoes")).toBe("default");
    expect(v("Romaine Lettuce")).toBe("head");
    expect(v("Spinach")).toBe("default");
    expect(v("Bagels")).toBe("bagel");
    expect(v("Tortillas")).toBe("flat");
    expect(v("Hamburger Buns")).toBe("bun");
    expect(v("Bread")).toBe("default");
    expect(v("Lay's")).toBe("default");
  });
});

describe("truncateLabel", () => {
  it("keeps short names and truncates long ones to 14 chars", () => {
    expect(truncateLabel("Milk")).toBe("Milk");
    expect(truncateLabel("Peanut Butter!")).toBe("Peanut Butter!");
    const t = truncateLabel("Honey Nut Cheerios");
    expect(t.length).toBeLessThanOrEqual(14);
    expect(t).toBe("Honey Nut Ch..");
  });
});

describe("palette", () => {
  const hex = /^#[0-9A-F]{6}$/i;
  it("hash is deterministic", () => {
    expect(hashString("Granola")).toBe(hashString("Granola"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("colours are deterministic, valid hex and primary != secondary for packages", () => {
    const names = ["Granola", "Pasta", "Rice", "Mystery Snack", "Sugar", "Flour", "Tea"];
    for (const name of names) {
      const a = foodColorsFor({ name, brand: null }, "box");
      expect(a).toEqual(foodColorsFor({ name, brand: null }, "box"));
      expect(a.primary).toMatch(hex);
      expect(a.secondary).toMatch(hex);
      expect(a.primary).not.toBe(a.secondary);
      expect(PACKAGE_PALETTE).toContain(a.primary);
    }
  });

  it("uses brand colours for known products", () => {
    expect(foodColorsFor({ name: "Lay's", brand: null }, "chips").primary).toBe("#FFC20E");
    expect(foodColorsFor({ name: "Oreos", brand: null }, "box").primary).toBe("#0A2A6B");
    expect(foodColorsFor({ name: "Doritos", brand: null }, "chips").primary).toBe("#D8232A");
    expect(foodColorsFor({ name: "Classic", brand: "Lay's" }, "chips").primary).toBe("#FFC20E");
  });

  it("uses natural colours for fresh food", () => {
    expect(foodColorsFor({ name: "Bananas", brand: null }, "fruit", "banana").primary).toBe("#F5D33F");
    expect(foodColorsFor({ name: "Carrots", brand: null }, "veg", "carrot").primary).toBe("#F57C00");
    expect(foodColorsFor({ name: "Milk", brand: null }, "carton").primary).toBe("#F7F7F2");
    for (const kind of ["fruit", "veg", "leafy", "meat", "fish", "cheese", "bread", "eggs", "jar", "bottle", "generic"] as FoodKind[]) {
      const c = foodColorsFor({ name: "Unknown", brand: null }, kind);
      expect(c.primary).toMatch(hex);
      expect(c.secondary).toMatch(hex);
    }
  });

  it("darken/lighten mix toward black/white", () => {
    expect(darken("#FFFFFF", 1)).toBe("#000000");
    expect(lighten("#000000", 1)).toBe("#FFFFFF");
    expect(darken("#808080", 0)).toBe("#808080");
  });
});
