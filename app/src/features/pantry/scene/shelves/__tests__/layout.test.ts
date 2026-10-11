import type { PantryItem, ShelfGroup, ShelfSection } from "../../../types";
import {
  APPLIANCE_FOOTER_HEIGHT,
  APPLIANCE_HEADER_HEIGHT,
  computeLayout,
  EMPTY_LABEL,
  fillerRows,
  ITEM_CLEARANCE,
  ITEM_SPACING,
  itemWorldPosition,
  ROW_HEIGHT,
  sectionTopY,
  totalHeight,
  visibleWindow,
} from "../layout";

function item(id: string, group: ShelfGroup): PantryItem {
  return {
    id,
    itemId: `i-${id}`,
    name: id,
    brand: null,
    category: null,
    location: null,
    group,
    allergens: [],
    status: "in_stock",
    expiresAt: null,
    caloriesPerServing: null,
    healthScore: null,
    imageUrl: null,
    ingredients: null,
    servingSize: null,
  };
}

function section(group: ShelfGroup, n: number): ShelfSection {
  return { group, label: group, items: Array.from({ length: n }, (_, i) => item(`${group}${i}`, group)) };
}

describe("shelf layout", () => {
  const sections = [section("snacks", 7), section("fridge", 3), section("freezer", 1)];

  it("wraps more than 5 items onto extra rows and stacks sections downwards", () => {
    expect(sectionTopY(sections, 0)).toBe(0);
    expect(sectionTopY(sections, 1)).toBeCloseTo(-2 * ROW_HEIGHT);
    const fridgeH = APPLIANCE_HEADER_HEIGHT + ROW_HEIGHT + APPLIANCE_FOOTER_HEIGHT;
    expect(sectionTopY(sections, 2)).toBeCloseTo(-2 * ROW_HEIGHT - fridgeH);
    expect(totalHeight(sections)).toBeCloseTo(2 * ROW_HEIGHT + 2 * fridgeH);
  });

  it("positions items consistently between computeLayout and itemWorldPosition", () => {
    const layout = computeLayout(sections);
    for (const row of layout.rows) {
      for (const { item: it, position } of row.items) {
        const p = itemWorldPosition(sections, it.id)!;
        expect(p[0]).toBeCloseTo(position[0]);
        expect(p[1]).toBeCloseTo(position[1]);
        expect(p[2]).toBeCloseTo(position[2]);
      }
    }
    // 6th and 7th snacks share the centred second row
    const sixth = itemWorldPosition(sections, "snacks5")!;
    expect(sixth[0]).toBeCloseTo(-ITEM_SPACING / 2);
    expect(sixth[1]).toBeCloseTo(-ROW_HEIGHT - ITEM_CLEARANCE);
    // first row of 5 spans ±2 spacings
    expect(itemWorldPosition(sections, "snacks0")![0]).toBeCloseTo(-2 * ITEM_SPACING);
    // fridge items sit below the header
    expect(itemWorldPosition(sections, "fridge0")![1]).toBeCloseTo(
      -2 * ROW_HEIGHT - APPLIANCE_HEADER_HEIGHT - ITEM_CLEARANCE,
    );
    expect(itemWorldPosition(sections, "nope")).toBeNull();
    expect(layout.appliances.map((a) => a.theme)).toEqual(["fridge", "freezer"]);
  });

  it("shows friendly empty shelves when there are no sections", () => {
    const layout = computeLayout([]);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.some((r) => r.label === EMPTY_LABEL)).toBe(true);
    expect(totalHeight([])).toBeCloseTo(3 * ROW_HEIGHT);
  });

  it("generates filler rows only inside the mounted window", () => {
    const h = totalHeight(sections);
    const top = fillerRows(h, visibleWindow(0));
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((r) => r.items.length === 0 && r.theme === "wood")).toBe(true);
    // scrolled far into the middle of a very tall column: no filler at all
    expect(fillerRows(100, visibleWindow(50))).toHaveLength(0);
    // negative camera-y convention maps to the same window
    expect(visibleWindow(-3)).toEqual(visibleWindow(3));
  });
});
