import type { CabinetItem } from "@contracts/cabinet";
import type { ShoppingListItem } from "@contracts/shoppingList";
import { screen } from "@testing-library/react-native";
import { createElement } from "react";
import { Text } from "react-native";

import { api } from "@/api/client";
import { apiRoutes, renderWithProviders, testGroup } from "@/test-utils";

import { buildSections, groupFor, toPantryItem, usePantry } from "../data";
import { activeFilterCount, applyFilters, isAllergic, searchItems } from "../filters";
import { EMPTY_FILTERS, type PantryFilters, type PantryItem } from "../types";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
const apiMock = api as jest.Mock;

const g = testGroup.id;

function row(over: Partial<CabinetItem> & { name?: string; category?: string | null } = {}): CabinetItem {
  const { name = "Thing", category = null, ...rest } = over;
  const id = rest.id ?? `c-${name}`;
  return {
    id,
    groupId: g,
    itemId: `i-${id}`,
    item: { id: `i-${id}`, name, category },
    product: null,
    allergens: [],
    status: "in_stock",
    quantityText: null,
    location: null,
    purchasedAt: null,
    expiresAt: null,
    expirationSource: null,
    photoUrl: null,
    addedBy: null,
    createdAt: "",
    updatedAt: "",
    ...rest,
  };
}

function item(over: Partial<PantryItem> & { name: string }): PantryItem {
  return {
    id: over.name,
    itemId: `i-${over.name}`,
    brand: null,
    category: null,
    location: null,
    group: "ingredients",
    allergens: [],
    status: "in_stock",
    expiresAt: null,
    caloriesPerServing: null,
    healthScore: null,
    imageUrl: null,
    ingredients: null,
    servingSize: null,
    ...over,
  };
}

const filters = (over: Partial<PantryFilters>): PantryFilters => ({ ...EMPTY_FILTERS, ...over });
const visibleNames = (items: PantryItem[], f: PantryFilters, mine: PantryItem["allergens"] = [], now?: Date) =>
  [...applyFilters(items, f, mine, now).visible].sort();

describe("groupFor", () => {
  it.each([
    [{ location: "fridge", category: "snacks" }, "fridge"],
    [{ location: "freezer", category: "produce" }, "freezer"],
    [{ location: "pantry", category: "snacks" }, "snacks"],
    [{ location: null, category: "beverages" }, "snacks"],
    [{ location: null, category: "produce" }, "produce"],
    [{ location: "other", category: "dairy" }, "fridge"],
    [{ location: null, category: "meat" }, "fridge"],
    [{ location: null, category: "seafood" }, "fridge"],
    [{ location: "pantry", category: "frozen" }, "freezer"],
    [{ location: null, category: "pantry" }, "ingredients"],
    [{ location: null, category: "bakery" }, "ingredients"],
    [{ location: null, category: "other" }, "ingredients"],
    [{ location: null, category: "household" }, "ingredients"],
    [{ location: null, category: null }, "ingredients"],
    [{ location: null, category: "something-new" }, "ingredients"],
  ] as const)("%j → %s", ({ location, category }, expected) => {
    expect(groupFor(row({ location, category }))).toBe(expected);
  });
});

describe("toPantryItem", () => {
  it("flattens a cabinet row with a product", () => {
    const r = row({
      id: "c1",
      name: "Milk",
      category: "dairy",
      location: "pantry",
      status: "running_low",
      expiresAt: "2026-10-12",
      allergens: ["milk", "soy"],
      product: { id: "p1", brand: "Moo", name: "Moo Milk", imageUrl: "https://img/p", caloriesPerServing: 120, healthScore: "B", ingredients: "Milk, vitamin D3", servingSize: "1 cup (240 ml)" },
    });
    expect(toPantryItem(r)).toEqual({
      id: "c1",
      itemId: "i-c1",
      name: "Milk",
      brand: "Moo",
      category: "dairy",
      location: "pantry",
      group: "fridge",
      allergens: ["milk", "soy"],
      status: "running_low",
      expiresAt: "2026-10-12",
      caloriesPerServing: 120,
      healthScore: "B",
      imageUrl: "https://img/p",
      ingredients: "Milk, vitamin D3",
      servingSize: "1 cup (240 ml)",
    });
  });

  it("without a product: nulls; an uploaded photo wins over the product image", () => {
    expect(toPantryItem(row({ name: "Rice" }))).toMatchObject({ brand: null, caloriesPerServing: null, healthScore: null, imageUrl: null, ingredients: null, servingSize: null });
    const withPhoto = row({
      photoUrl: "https://img/photo",
      product: { id: "p", brand: null, name: "x", imageUrl: "https://img/p", caloriesPerServing: null, healthScore: null, ingredients: null, servingSize: null },
    });
    expect(toPantryItem(withPhoto).imageUrl).toBe("https://img/photo");
  });
});

describe("buildSections", () => {
  it("returns only non-empty groups, in shelf order, labelled, items sorted by name", () => {
    const items = [
      item({ name: "zucchini", group: "produce" }),
      item({ name: "Peas", group: "freezer" }),
      item({ name: "Chips", group: "snacks" }),
      item({ name: "apples", group: "produce" }),
      item({ name: "Butter", group: "fridge" }),
    ];
    const sections = buildSections(items);
    expect(sections.map((s) => s.label)).toEqual(["SNACKS", "PRODUCE", "FRIDGE", "FREEZER"]);
    expect(sections.map((s) => s.group)).toEqual(["snacks", "produce", "fridge", "freezer"]);
    expect(sections[1]!.items.map((i) => i.name)).toEqual(["apples", "zucchini"]);
  });

  it("all five groups in order; empty pantry → no sections", () => {
    const groups = ["freezer", "fridge", "produce", "ingredients", "snacks"] as const;
    expect(buildSections(groups.map((group) => item({ name: group, group }))).map((s) => s.label)).toEqual([
      "SNACKS",
      "INGREDIENTS",
      "PRODUCE",
      "FRIDGE",
      "FREEZER",
    ]);
    expect(buildSections([])).toEqual([]);
  });
});

describe("isAllergic", () => {
  it("is true only when the item shares one of my allergens", () => {
    const pb = item({ name: "PB", allergens: ["peanuts", "soy"] });
    expect(isAllergic(pb, ["peanuts"])).toBe(true);
    expect(isAllergic(pb, ["milk"])).toBe(false);
    expect(isAllergic(pb, [])).toBe(false);
    expect(isAllergic(item({ name: "Rice" }), ["milk"])).toBe(false);
  });
});

describe("applyFilters", () => {
  const items = [
    item({ name: "PB", allergens: ["peanuts"], healthScore: "D", caloriesPerServing: 190, group: "ingredients" }),
    item({ name: "Milk", allergens: ["milk"], healthScore: "b", caloriesPerServing: 100, group: "fridge", expiresAt: "2026-10-12" }),
    item({ name: "Apples", healthScore: "A", caloriesPerServing: 50, group: "produce", status: "running_low", expiresAt: "2026-10-14" }),
    item({ name: "Rice", group: "ingredients", expiresAt: "2026-10-01" }),
  ];

  it("no filters → everything visible", () => {
    expect(visibleNames(items, EMPTY_FILTERS)).toEqual(["Apples", "Milk", "PB", "Rice"]);
  });

  it("excludeAllergens hides items containing any of them", () => {
    expect(visibleNames(items, filters({ excludeAllergens: ["peanuts", "milk"] }))).toEqual(["Apples", "Rice"]);
  });

  it("safeForMe hides items with my allergens; no allergens → no effect", () => {
    expect(visibleNames(items, filters({ safeForMe: true }), ["milk"])).toEqual(["Apples", "PB", "Rice"]);
    expect(visibleNames(items, filters({ safeForMe: true }), [])).toHaveLength(4);
  });

  it("healthScores keeps matching letters (case-insensitive); unknown score is hidden", () => {
    expect(visibleNames(items, filters({ healthScores: ["A", "B"] }))).toEqual(["Apples", "Milk"]);
  });

  it("maxCalories keeps items at or under the limit; unknown calories hidden", () => {
    expect(visibleNames(items, filters({ maxCalories: 100 }))).toEqual(["Apples", "Milk"]);
    expect(visibleNames(items, filters({ maxCalories: 0 }))).toEqual([]);
  });

  it("groups keeps only the chosen shelf groups", () => {
    expect(visibleNames(items, filters({ groups: ["produce", "fridge"] }))).toEqual(["Apples", "Milk"]);
  });

  it("expiringSoon: within 3 days of today (local), including already expired; no date → hidden", () => {
    const now = new Date(2026, 9, 10, 23, 30); // Oct 10, 11:30 pm local
    expect(visibleNames(items, filters({ expiringSoon: true }), [], now)).toEqual(["Milk", "Rice"]);
    const later = new Date(2026, 9, 11, 0, 5); // just after local midnight → Oct 14 is now within 3 days
    expect(visibleNames(items, filters({ expiringSoon: true }), [], later)).toEqual(["Apples", "Milk", "Rice"]);
  });

  it("runningLow keeps running_low items", () => {
    expect(visibleNames(items, filters({ runningLow: true }))).toEqual(["Apples"]);
  });

  it("filters combine with AND", () => {
    expect(visibleNames(items, filters({ groups: ["ingredients", "produce"], maxCalories: 200, safeForMe: true }), ["peanuts"])).toEqual([
      "Apples",
    ]);
  });
});

describe("activeFilterCount", () => {
  it("counts one per active criterion", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(filters({ excludeAllergens: ["milk", "eggs"], maxCalories: 0 }))).toBe(2);
    expect(
      activeFilterCount({
        excludeAllergens: ["milk"],
        safeForMe: true,
        healthScores: ["A"],
        maxCalories: 300,
        groups: ["snacks"],
        expiringSoon: true,
        runningLow: true,
      }),
    ).toBe(7);
  });
});

describe("searchItems", () => {
  const items = [
    item({ name: "Peanut Butter", brand: "Jif" }),
    item({ name: "Butter", brand: "Kerrygold" }),
    item({ name: "Buttermilk" }),
    item({ name: "Jalapeño Chips", brand: "Kettle" }),
    item({ name: "Shea" , brand: "Nutter Butter Co" }),
    item({ name: "Rice" }),
  ];
  const names = (q: string) => searchItems(items, q).map((i) => i.name);

  it("ranks prefix > word prefix > substring, name before brand", () => {
    expect(names("butter")).toEqual(["Butter", "Buttermilk", "Peanut Butter", "Shea"]);
    expect(names("utter")).toEqual(["Butter", "Buttermilk", "Peanut Butter", "Shea"]);
    expect(names("milk")).toEqual(["Buttermilk"]);
  });

  it("matches brand, case- and accent-insensitive", () => {
    expect(names("JIF")).toEqual(["Peanut Butter"]);
    expect(names("jalapeno")).toEqual(["Jalapeño Chips"]);
    expect(names("JALAPEÑO")).toEqual(["Jalapeño Chips"]);
    expect(names("kett")).toEqual(["Jalapeño Chips"]);
  });

  it("blank query or no match → []", () => {
    expect(names("   ")).toEqual([]);
    expect(names("xyz")).toEqual([]);
  });
});

describe("usePantry", () => {
  function Probe() {
    const p = usePantry(g);
    if (p.isLoading) return createElement(Text, null, "loading");
    return createElement(
      Text,
      { testID: "out" },
      JSON.stringify({
        sections: p.sections.map((s) => [s.label, s.items.map((i) => i.name)]),
        mine: p.myAllergens,
        preview: p.listPreview,
        error: !!p.error,
      }),
    );
  }

  const listRow = (name: string, checked: boolean): ShoppingListItem => ({
    id: `l-${name}`,
    groupId: g,
    itemId: `i-${name}`,
    item: { id: `i-${name}`, name, category: null },
    reason: "preference",
    wantedBy: [],
    quantityText: null,
    allergenFlags: [],
    checked,
    checkedBy: null,
    checkedAt: null,
    scannedProductId: null,
    addedBy: null,
    note: null,
    createdAt: "",
    updatedAt: "",
  });

  it("combines cabinet, dietary and list into sections, my allergens and the first 3 unchecked list names", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        [`GET /groups/${g}/cabinet`]: () => [
          row({ name: "Oreos", category: "snacks", allergens: ["wheat", "milk"] }),
          row({ name: "Milk", category: "dairy" }),
          row({ name: "Apples", category: "produce" }),
        ],
        "GET /me/dietary": () => ({ diets: [], allergens: ["milk"] }),
        [`GET /groups/${g}/shopping-list`]: () => [
          listRow("Ham", false),
          listRow("Bread", true),
          listRow("Eggs", false),
          listRow("Rice", false),
          listRow("Tea", false),
        ],
      }),
    );
    await renderWithProviders(createElement(Probe));
    const out = await screen.findByTestId("out");
    await screen.findByText(/"preview":\["Ham","Eggs","Rice"\]/);
    expect(JSON.parse(String(out.props.children))).toEqual({
      sections: [
        ["SNACKS", ["Oreos"]],
        ["PRODUCE", ["Apples"]],
        ["FRIDGE", ["Milk"]],
      ],
      mine: ["milk"],
      preview: ["Ham", "Eggs", "Rice"],
      error: false,
    });
  });

  it("surfaces a cabinet error", async () => {
    apiMock.mockImplementation(apiRoutes({ "GET /me/dietary": () => ({ diets: [], allergens: [] }) }));
    await renderWithProviders(createElement(Probe));
    await screen.findByText(/"error":true/);
  });
});
