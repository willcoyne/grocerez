import type { ShoppingListItem } from "@contracts/shoppingList";

import { AISLE_ORDER, aisleFor, allergenSummary, buildStoreSections, tagBadge, toPantryItem, toStoreItem } from "../mapping";
import { buildAisleLayout, columnsFor, LEVEL_Y, arcPoint } from "../scene/layout";

const ME = "00000000-0000-4000-8000-000000000101";
const ANN = "00000000-0000-4000-8000-000000000202";
let n = 0;
function row(name: string, category: string | null, over: Partial<ShoppingListItem> = {}): ShoppingListItem {
  n += 1;
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  const itemId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
  return {
    id,
    groupId: "11111111-1111-4111-8111-111111111111",
    itemId,
    item: { id: itemId, name, category },
    reason: "preference",
    wantedBy: [],
    quantityText: null,
    allergenFlags: [],
    checked: false,
    checkedBy: null,
    checkedAt: null,
    scannedProductId: null,
    addedBy: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("ShoppingListItem → PantryItem", () => {
  it("keeps the row id and item name/category, takes allergens from the flags (deduped)", () => {
    const r = row("Peanut Butter", "pantry", {
      allergenFlags: [
        { userId: ME, displayName: "Carson", allergen: "peanuts" },
        { userId: ANN, displayName: "Ann", allergen: "peanuts" },
        { userId: ANN, displayName: "Ann", allergen: "soy" },
      ],
    });
    const p = toPantryItem(r);
    expect(p).toMatchObject({ id: r.id, itemId: r.itemId, name: "Peanut Butter", category: "pantry", status: "in_stock", group: "ingredients" });
    expect(p.allergens).toEqual(["peanuts", "soy"]);
  });

  it("maps categories to shelf groups the FoodItem understands", () => {
    expect(toPantryItem(row("Milk", "dairy")).group).toBe("fridge");
    expect(toPantryItem(row("Peas", "frozen")).group).toBe("freezer");
    expect(toPantryItem(row("Apples", "produce")).group).toBe("produce");
    expect(toPantryItem(row("Thing", null)).group).toBe("ingredients");
  });

  it("glows only for the signed-in user's flags; other members go on the badge, named", () => {
    const r = row("Granola", "pantry", {
      allergenFlags: [{ userId: ANN, displayName: "Ann", allergen: "tree_nuts" }],
    });
    const other = toStoreItem(r, ME);
    expect(other.mine).toBe(false);
    expect(other.others).toHaveLength(1);
    expect(other.badge).toBe("Ann · tree nuts");

    const mine = toStoreItem(row("Milk", "dairy", { allergenFlags: [{ userId: ME, displayName: "Carson", allergen: "milk" }] }), ME);
    expect(mine.mine).toBe(true);
    expect(mine.badge).toBe("You · milk");
    expect(toStoreItem(row("Rice", "pantry"), ME).badge).toBeNull();
  });

  it("badge text stays short and puts me first", () => {
    expect(
      tagBadge(
        [
          { userId: ANN, displayName: "Ann", allergen: "milk" },
          { userId: ME, displayName: "Carson", allergen: "eggs" },
          { userId: ANN, displayName: "Ann", allergen: "sesame" },
        ],
        ME,
      ),
    ).toBe("You +1 · 3 allergens");
    expect(allergenSummary([{ userId: ANN, displayName: "Ann", allergen: "peanuts" }], ME)).toBe("Contains peanuts (Ann)");
  });
});

describe("aisles", () => {
  it("follows the store order from CATEGORIES with meat & seafood sharing a counter", () => {
    expect(AISLE_ORDER).toEqual(["produce", "bakery", "meat", "dairy", "frozen", "pantry", "snacks", "beverages", "household", "other"]);
    expect(aisleFor("seafood")).toBe("meat");
    expect(aisleFor("Dairy")).toBe("dairy");
    expect(aisleFor("baking")).toBe("other");
    expect(aisleFor(null)).toBe("other");
  });

  it("builds non-empty sections in aisle order, items by name", () => {
    const items = [row("Salmon", "seafood"), row("Bananas", "produce"), row("Apples", "produce"), row("Ice Cream", "frozen"), row("Steak", "meat")].map(
      (r) => toStoreItem(r, ME),
    );
    const sections = buildStoreSections(items);
    expect(sections.map((s) => s.label)).toEqual(["PRODUCE", "MEAT & SEAFOOD", "FROZEN"]);
    expect(sections[0].items.map((i) => i.pantry.name)).toEqual(["Apples", "Bananas"]);
    expect(sections[2].theme).toBe("freezer");
  });

  it("lays sections side by side along x with eye-level shelves filled first", () => {
    const items = Array.from({ length: 9 }, (_, i) => toStoreItem(row(`Item ${i}`, "pantry"), ME));
    const layout = buildAisleLayout(buildStoreSections([...items, toStoreItem(row("Chips", "snacks"), ME)]));
    expect(layout.sections).toHaveLength(2);
    const [pantry, snacks] = layout.sections;
    expect(pantry.x0).toBe(0);
    expect(snacks.x0).toBeCloseTo(pantry.x1);
    expect(columnsFor(9)).toBe(3);
    expect(pantry.slots[0].y).toBe(LEVEL_Y[2]);
    expect(pantry.slots[1].y).toBe(LEVEL_Y[1]);
    expect(pantry.slots[4].x).toBeGreaterThan(pantry.slots[0].x);
    expect(layout.slotById.size).toBe(10);
    expect(layout.end).toBeCloseTo(snacks.x1);
  });

  it("hop arc starts and ends at the endpoints and peaks in the middle", () => {
    const out = { x: 0, y: 0, z: 0 };
    const a = { x: 0, y: 1, z: 0 };
    const b = { x: 2, y: 0, z: 3 };
    expect(arcPoint(a, b, 0, 0.5, out)).toEqual(a);
    expect(arcPoint(a, b, 1, 0.5, out)).toEqual(b);
    expect(arcPoint(a, b, 0.5, 0.5, out).y).toBeCloseTo(1);
  });
});
