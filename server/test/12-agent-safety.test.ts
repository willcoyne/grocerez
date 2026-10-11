import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { safety } from "../src/modules/agent/safety.js";
import { api, makeGroup, makeUser } from "./helpers.js";

/** Household: Carson (peanuts), Maya (milk), Veg (vegetarian), Sam (soy), plus an owner with no restrictions. */
async function household() {
  const owner = await makeUser({ displayName: "Owner" });
  const carson = await makeUser({ displayName: "Carson", allergens: ["peanuts"] });
  const maya = await makeUser({ displayName: "Maya", allergens: ["milk"] });
  const veg = await makeUser({ displayName: "Veg" });
  await prisma.userDiet.create({ data: { userId: veg.id, diet: "vegetarian" } });
  const sam = await makeUser({ displayName: "Sam", allergens: ["soy"] });
  const g = await makeGroup(owner, [carson, maya, veg, sam]);
  return { owner, g };
}

const meal = (title: string, ...ingredients: string[]) => ({ title, ingredients });

describe("12 agent safety check (per member)", () => {
  it("peanut butter vs a peanut-allergic member fails and names the member", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("PB toast", "Peanut butter", "Bread")])).meals;
    expect(m.passes).toBe(false);
    expect(m.problems).toContainEqual({ ingredient: "Peanut butter", reason: "contains peanuts", members: ["Carson"] });
    // The title "PB toast" is checked too ("pb" is a peanut keyword). Bread is wheat/gluten but nobody here is allergic.
    expect(m.problems).toEqual([
      { ingredient: "Peanut butter", reason: "contains peanuts", members: ["Carson"] },
      { ingredient: "PB toast", reason: "contains peanuts", members: ["Carson"] },
    ]);
  });

  it("PB toast (title + ingredient 'PB') fails for the peanut member; Nutella fails for milk AND tree-nut members", async () => {
    const owner = await makeUser({ displayName: "Owner" });
    const carson = await makeUser({ displayName: "Carson", allergens: ["peanuts"] });
    const maya = await makeUser({ displayName: "Maya", allergens: ["milk"] });
    const nora = await makeUser({ displayName: "Nora", allergens: ["tree_nuts"] });
    const g = await makeGroup(owner, [carson, maya, nora]);
    const [pb, nutella] = (await safety.check(g.id, [meal("PB toast", "PB", "Bread"), meal("Crepes", "Nutella")])).meals;
    expect(pb.passes).toBe(false);
    expect(pb.problems).toContainEqual({ ingredient: "PB", reason: "contains peanuts", members: ["Carson"] });
    expect(nutella.passes).toBe(false);
    expect(nutella.problems).toEqual(expect.arrayContaining([
      { ingredient: "Nutella", reason: "contains milk", members: ["Maya"] },
      { ingredient: "Nutella", reason: "contains tree_nuts", members: ["Nora"] },
    ]));
  });

  it("'Fresh Basil' is verified through a whole-word suggested match; 'Custard' stays unknown and fails an allergy household", async () => {
    const { g } = await household();
    const [basil, custard] = (await safety.check(g.id, [meal("Pasta", "Fresh Basil"), meal("Dessert", "Custard")])).meals;
    expect(basil).toMatchObject({ passes: true, unknown: [] });
    // Plural last word still matches (normalize de-pluralizes it) and it's still meat for the vegetarian.
    const [chicken] = (await safety.check(g.id, [meal("Dinner", "Boneless Chicken Breasts")])).meals;
    expect(chicken.unknown).toEqual([]);
    expect(chicken.problems).toContainEqual({ ingredient: "Boneless Chicken Breasts", reason: "not vegetarian", members: ["Veg"] });
    expect(custard.unknown).toEqual(["Custard"]);
    expect(custard.passes).toBe(false);
    expect(custard.problems).toContainEqual({
      ingredient: "Custard", reason: "couldn't verify ingredients (allergy household)", members: ["Carson", "Maya", "Sam"],
    });
  });

  it("almond milk vs a milk-allergic member passes (EXCLUDE table), and tree nuts bother nobody here", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Smoothie", "almond milk", "Bananas")])).meals;
    expect(m).toMatchObject({ passes: true, problems: [], unknown: [] });
  });

  it("spinach passes with nothing unknown", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Greens", "Spinach")])).meals;
    expect(m).toEqual({ title: "Greens", passes: true, problems: [], unknown: [] });
  });

  it("za'atar (no catalog match, no keyword) FAILS when anyone has an allergen; passes as unknown otherwise", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Flatbread spice", "za'atar", "Spinach")])).meals;
    expect(m).toEqual({
      title: "Flatbread spice", passes: false, unknown: ["za'atar"],
      problems: [{ ingredient: "za'atar", reason: "couldn't verify ingredients (allergy household)", members: ["Carson", "Maya", "Sam"] }],
    });

    // No allergens (a diet-only member is fine): unknown is listed but the meal passes.
    const owner = await makeUser({ displayName: "Owner" });
    const veg = await makeUser({ displayName: "Veg" });
    await prisma.userDiet.create({ data: { userId: veg.id, diet: "vegetarian" } });
    const plain = await makeGroup(owner, [veg]);
    const [p] = (await safety.check(plain.id, [meal("Flatbread spice", "za'atar", "Spinach")])).meals;
    expect(p).toEqual({ title: "Flatbread spice", passes: true, problems: [], unknown: ["za'atar"] });
  });

  it("chicken vs a vegetarian member fails with 'not vegetarian'", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Lemon chicken", "Chicken Breast", "Lemons")])).meals;
    expect(m.passes).toBe(false);
    expect(m.problems).toEqual([
      { ingredient: "Chicken Breast", reason: "not vegetarian", members: ["Veg"] },
      // The title is checked too (people cook what it says).
      { ingredient: "Lemon chicken", reason: "not vegetarian", members: ["Veg"] },
    ]);
  });

  it("meat by catalog category or plural (Hot Dogs, Steaks, Meatballs, Chickens) fails a vegetarian; steps are checked", async () => {
    const { g } = await household();
    const res = await safety.check(g.id, ["Hot Dogs", "Steaks", "Meatballs", "Chickens"].map((n) => meal("Dinner", n)));
    expect(res.meals.map((m) => m.passes)).toEqual([false, false, false, false]);
    const [s] = (await safety.check(g.id, [{ title: "Noodles", ingredients: ["Rice"], steps: ["Whisk the peanut butter."] }])).meals;
    expect(s.problems).toEqual([{ ingredient: "Whisk the peanut butter.", reason: "contains peanuts", members: ["Carson"] }]);
  });

  it("a fuzzy 'suggested' hit that isn't a whole-word match is not verification: listed as unknown", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Dessert", "Custard")])).meals;
    expect(m.unknown).toContain("Custard");
  });

  it("uses the catalog's default allergens when the name has no keyword (Oreos → soy)", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Dessert", "Oreos")])).meals;
    expect(m.passes).toBe(false);
    expect(m.problems).toEqual([{ ingredient: "Oreos", reason: "contains soy", members: ["Sam"] }]);
  });

  it("cheddar fails for the milk member only; several members on one problem are listed together", async () => {
    const owner = await makeUser({ displayName: "Owner" });
    const a = await makeUser({ displayName: "Ann", allergens: ["milk"] });
    const b = await makeUser({ displayName: "Bob", allergens: ["milk"] });
    const g = await makeGroup(owner, [a, b]);
    const [m] = (await safety.check(g.id, [meal("Quesadilla", "Cheddar Cheese", "Tortillas")])).meals;
    expect(m.problems).toEqual([{ ingredient: "Cheddar Cheese", reason: "contains milk", members: ["Ann", "Bob"] }]);
  });

  it("POST /agent/safety-check checks steps too: 'Stir in butter' fails for the milk-allergic member", async () => {
    const { owner, g } = await household();
    const res = await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth)
      .send({ meals: [{ title: "Rice bowl", ingredients: ["Rice"], steps: ["Cook the rice.", "Stir in butter"] }] });
    expect(res.status).toBe(200);
    expect(res.body.meals[0]).toMatchObject({
      passes: false,
      problems: [{ ingredient: "Stir in butter", reason: "contains milk", members: ["Maya"] }],
    });
    const bad = await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth)
      .send({ meals: [{ title: "x", ingredients: ["Rice"], steps: Array(7).fill("Stir.") }] });
    expect(bad.status).toBe(400);
  });

  it("POST /agent/safety-check returns the same result; non-member → 404; bad body → 400", async () => {
    const { owner, g } = await household();
    const body = { meals: [meal("PB toast", "Peanut butter"), meal("Greens", "Spinach")] };
    const res = await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth).send(body);
    expect(res.status).toBe(200);
    expect(res.body.meals.map((m: { passes: boolean }) => m.passes)).toEqual([false, true]);
    expect(res.body).toEqual(await safety.check(g.id, body.meals));

    const outsider = await makeUser();
    expect((await api().post(`/api/groups/${g.id}/agent/safety-check`).set(outsider.auth).send(body)).status).toBe(404);
    expect((await api().post(`/api/groups/${g.id}/agent/safety-check`).set(owner.auth).send({ meals: [] })).status).toBe(400);
  });
});
