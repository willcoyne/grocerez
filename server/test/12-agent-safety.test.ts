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
    // Bread is wheat/gluten but nobody here is allergic to those.
    expect(m.problems).toHaveLength(1);
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

  it("za'atar (no catalog match, no keyword) → unknown, which does not fail the meal", async () => {
    const { g } = await household();
    const [m] = (await safety.check(g.id, [meal("Flatbread spice", "za'atar", "Spinach")])).meals;
    expect(m).toEqual({ title: "Flatbread spice", passes: true, problems: [], unknown: ["za'atar"] });
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

  it("a fuzzy 'suggested' hit is not verification: the ingredient is listed as unknown", async () => {
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
