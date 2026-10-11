import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import type { AgentRunRequest, IndexedRecipe } from "../src/contracts/agent.js";
import { prisma } from "../src/db.js";
import { agentClient } from "../src/lib/agentClient.js";
import { http } from "../src/lib/http.js";
import { rankByKitchenFit, recipeIndex } from "../src/modules/agent/recipes.js";
import { api, itemId, makeGroup, makeUser, type TestUser } from "./helpers.js";

// Recipe index (challenge 01 §12). Akamai is faked at the http.fetch boundary, like 12-embeddings.test.ts.

const SECRET = "r".repeat(48);
const HOST = "https://recipes.test/";
const saved = {
  key: config.AKAMAI_API_KEY, base: config.AKAMAI_BASE_URL, model: config.AKAMAI_EMBEDDING_MODEL,
  agentUrl: config.AGENT_URL, secret: config.AGENT_SHARED_SECRET,
};

/** Fake 1024-d model (the production dimension, so search uses the HNSW path): one axis per topic. */
const fakeVector = (text: string) => {
  const t = text.toLowerCase();
  const v = new Array(1024).fill(0);
  v[3] = 0.05; // never a zero vector
  if (/chicken/.test(t)) v[0] = 1;
  if (/pasta|noodle|pizza/.test(t)) v[1] = 1;
  if (/cookie|oreo|pie/.test(t)) v[2] = 1;
  return v;
};
const embedCalls: string[][] = [];
const fakeAkamai = async (url: string, init?: RequestInit) => {
  if (!url.endsWith("/embeddings")) throw new Error(`unexpected Akamai call ${url}`);
  const input: string[] = JSON.parse(String(init!.body)).input;
  embedCalls.push(input);
  return new Response(JSON.stringify({ data: input.map((s, index) => ({ index, embedding: fakeVector(s) })) }), { status: 200 });
};

const configure = () => {
  config.AKAMAI_API_KEY = "test-akamai-key";
  config.AKAMAI_BASE_URL = "https://akamai.test/v1";
  config.AKAMAI_EMBEDDING_MODEL = "hackathon-embedding";
};
const unconfigure = () => {
  config.AKAMAI_API_KEY = undefined;
  config.AKAMAI_BASE_URL = undefined;
};

const recipe = (slug: string, title: string, ingredientLines: string[], ingredients: string[]): IndexedRecipe => ({
  url: `${HOST}${slug}`, site: "Recipes Test", title, imageUrl: null, minutes: 30, servings: 4, ingredientLines, ingredients,
});
const CORPUS = [
  recipe("lemon-chicken", "Lemon Chicken", ["2 chicken breasts", "1 lemon", "2 cups spinach"], ["Chicken Breast", "Lemons", "Spinach"]),
  recipe("chicken-stir-fry", "Chicken Stir Fry", ["1 lb chicken", "2 cups broccoli"], ["Chicken Breast", "Broccoli"]),
  recipe("chicken-parm", "Chicken Parmesan", ["2 chicken breasts", "1 cup grated parmesan"], ["Chicken Breast", "Parmesan"]),
  recipe("satay", "Chicken Satay", ["1 lb chicken", "1/2 cup peanut butter"], ["Chicken Breast", "Peanut Butter"]),
  recipe("cookie-pie", "Cookie Crust Pie", ["20 sandwich cookies, crushed", "1 cup whipped topping"], ["Oreos"]),
  recipe("veggie-pasta", "Veggie Pasta", ["8 oz pasta", "1 zucchini"], ["Pasta", "Zucchini"]),
];

const ingest = (body: object, secret: string | null = SECRET) => {
  const r = api().post("/api/internal/recipes");
  if (secret !== null) r.set("X-Agent-Secret", secret);
  return r.send(body);
};
const row = (slug: string) =>
  prisma.$queryRaw<{ allergens: string[]; embedded: boolean; title: string }[]>`
    SELECT allergens::text[] AS allergens, embedding IS NOT NULL AS embedded, title FROM recipes WHERE url = ${HOST + slug}`
    .then((r) => r[0]);
const search = (u: TestUser, groupId: string, body: Record<string, unknown>) =>
  api().post(`/api/groups/${groupId}/agent/recipes/search`).set(u.auth).send(body);

beforeAll(async () => {
  await prisma.$executeRaw`DELETE FROM recipes WHERE url LIKE ${HOST + "%"}`;
  vi.spyOn(http, "fetch").mockImplementation(fakeAkamai);
});
beforeEach(() => {
  configure();
  config.AGENT_URL = "http://agent.test:8000";
  config.AGENT_SHARED_SECRET = SECRET;
});
afterEach(() => {
  config.AGENT_URL = saved.agentUrl;
  config.AGENT_SHARED_SECRET = saved.secret;
});
afterAll(async () => {
  vi.restoreAllMocks();
  Object.assign(config, {
    AKAMAI_API_KEY: saved.key, AKAMAI_BASE_URL: saved.base, AKAMAI_EMBEDDING_MODEL: saved.model,
  });
  await prisma.$executeRaw`DELETE FROM recipes WHERE url LIKE ${HOST + "%"}`;
});

describe("12 recipe index: ingest", () => {
  it("wrong or missing X-Agent-Secret → 401; a bad body → 400", async () => {
    expect((await ingest({ recipes: [CORPUS[0]] }, "x".repeat(48))).status).toBe(401);
    expect((await ingest({ recipes: [CORPUS[0]] }, null)).status).toBe(401);
    expect((await ingest({ recipes: [{ ...CORPUS[0], url: "http://insecure.test/x" }] })).status).toBe(400);
    expect((await ingest({ recipes: [] })).status).toBe(400);
  });

  it("without Akamai: upserts with computed allergens and no embedding; the backfill embeds them later", async () => {
    unconfigure();
    const res = await ingest({ recipes: CORPUS });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ upserted: CORPUS.length, embedded: 0 });

    expect(await row("chicken-parm")).toMatchObject({ allergens: ["milk"], embedded: false }); // "1 cup grated parmesan"
    expect((await row("satay")).allergens).toEqual(["peanuts"]); // Peanut Butter
    // "Oreos" has no allergen keyword: its catalog match's defaultAllergens are what flag it.
    expect((await row("cookie-pie")).allergens).toEqual(["gluten", "soy", "wheat"]);
    expect((await row("lemon-chicken")).allergens).toEqual([]);

    configure();
    embedCalls.length = 0;
    expect(await recipeIndex.embedMissing()).toBe(CORPUS.length);
    expect(embedCalls.flat()).toContain("Lemon Chicken: Chicken Breast, Lemons, Spinach"); // "title: ingredient names"
    expect((await row("lemon-chicken")).embedded).toBe(true);
    expect(await recipeIndex.embedMissing()).toBe(0);
  });

  it("re-ingest upserts by url, embeds inline, and keeps the embedding only while title + ingredients are unchanged", async () => {
    embedCalls.length = 0;
    const same = await ingest({ recipes: [CORPUS[0], CORPUS[1]] });
    expect(same.body).toEqual({ upserted: 2, embedded: 0 }); // unchanged text → embeddings kept
    expect(embedCalls).toHaveLength(0);

    const renamed = { ...CORPUS[1], title: "Chicken Stir Fry with Broccoli" };
    const changed = await ingest({ recipes: [renamed] });
    expect(changed.body).toEqual({ upserted: 1, embedded: 1 });
    expect(await row("chicken-stir-fry")).toMatchObject({ title: "Chicken Stir Fry with Broccoli", embedded: true });
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM recipes WHERE url LIKE ${HOST + "%"}`;
    expect(n).toBe(CORPUS.length);
  });
});

describe("12 recipe index: search", () => {
  async function household(extra: { allergens?: string[]; vegetarian?: boolean } = {}) {
    const owner = await makeUser({ displayName: "Owner", allergens: extra.allergens });
    if (extra.vegetarian) await prisma.userDiet.create({ data: { userId: owner.id, diet: "vegetarian" } });
    const g = await makeGroup(owner);
    return { owner, g };
  }

  it("excludes recipes whose allergens hit a member and boosts mustUse matches", async () => {
    const { owner, g } = await household({ allergens: ["milk", "peanuts"] });
    const res = await search(owner, g.id, { query: "chicken dinner", mustUse: ["spinach"], limit: 3 });
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    const titles = res.body.recipes.map((r: { title: string }) => r.title);
    expect(titles).not.toContain("Chicken Parmesan"); // milk
    expect(titles).not.toContain("Chicken Satay"); // peanuts
    // Lemon Chicken and the stir fry are equally close; Lemon Chicken uses spinach, so it ranks first.
    expect(res.body.recipes[0]).toMatchObject({ title: "Lemon Chicken", uses: ["spinach"], site: "Recipes Test" });
    expect(res.body.recipes[0].ingredientLines).toEqual(CORPUS[0].ingredientLines);
    expect(titles[1]).toBe("Chicken Stir Fry with Broccoli");
    expect(res.body.recipes[1].uses).toEqual([]);
    expect(typeof res.body.recipes[0].distance).toBe("number");
  });

  it("drops recipes that conflict with a member's diet (vegetarian: no chicken)", async () => {
    const { owner, g } = await household({ vegetarian: true });
    const res = await search(owner, g.id, { query: "chicken dinner", limit: 10 });
    const titles: string[] = res.body.recipes.map((r: { title: string }) => r.title);
    expect(titles.some((t) => /chicken/i.test(t))).toBe(false);
    expect(titles).toContain("Veggie Pasta");
    expect(titles).not.toContain("Cookie Crust Pie"); // a dessert: excluded as a non-dinner
  });

  it("available=false without Akamai, or when nothing is embedded for the current model", async () => {
    const { owner, g } = await household();
    unconfigure();
    expect((await search(owner, g.id, { query: "chicken" })).body).toEqual({ recipes: [], available: false });
    configure();
    config.AKAMAI_EMBEDDING_MODEL = "some-other-model";
    expect((await search(owner, g.id, { query: "chicken" })).body).toEqual({ recipes: [], available: false });
  });

  it("non-dinner titles are excluded in SQL: sauces, desserts, breads (only when the title ends with that noun)", async () => {
    const titles = [
      "Homemade Pizza Sauce", "Pizza Sauce Recipe", "Pasta with Tomato Sauce", "Spaghetti and Meat Sauce", "Chicken Stir-Fry",
      "Chicken Pot Pie", "Apple Pie", "Crab Cakes", "Carrot Cake", "Egg Rolls", "Cinnamon Rolls", "French Dip", "Garlic Bread",
      "Chicken Broth", "Mussels in White Wine Broth", "Butter Chicken", "Lemon Bars", "Best Ever Brownies (Fudgy!)",
    ];
    const rows = await prisma.$queryRaw<{ t: string; x: boolean }[]>`
      SELECT t, t ~* ${config.RECIPE_NON_DINNER_TITLE} AS x FROM unnest(${titles}::text[]) AS t`;
    const excluded = rows.filter((r) => r.x).map((r) => r.t);
    expect(excluded).toEqual([
      "Homemade Pizza Sauce", "Pizza Sauce Recipe", "Apple Pie", "Carrot Cake", "Cinnamon Rolls", "Garlic Bread", "Chicken Broth",
      "Lemon Bars", "Best Ever Brownies (Fudgy!)",
    ]);

    // End to end: the sauce is as close to "pasta" as the dinner, but never comes back.
    await ingest({
      recipes: [
        recipe("pizza-sauce", "Homemade Pizza Sauce", ["1 can crushed tomatoes", "2 cloves garlic"], ["Canned Tomatoes", "Garlic"]),
        recipe("pasta-tomato", "Pasta with Tomato Sauce", ["8 oz pasta", "1 can crushed tomatoes"], ["Pasta", "Canned Tomatoes"]),
      ],
    }).expect(200);
    const { owner, g } = await household();
    const res = await search(owner, g.id, { query: "tomato pasta", limit: 10 });
    const found: string[] = res.body.recipes.map((r: { title: string }) => r.title);
    expect(found).toContain("Pasta with Tomato Sauce");
    expect(found).not.toContain("Homemade Pizza Sauce");
    expect((await search(owner, g.id, { query: "chicken", limit: 10 })).body.recipes.map((r: { title: string }) => r.title))
      .toContain("Lemon Chicken");
  });

  it("kitchen fit: of two equally similar recipes, the one using more cabinet items ranks first", async () => {
    await ingest({
      recipes: [
        recipe("pasta-fancy", "Pasta Night Fancy", ["8 oz pasta", "1 pinch saffron", "1 truffle", "2 tbsp capers", "1 leek", "1 fennel"],
          ["Pasta", "Saffron", "Truffle", "Capers", "Leeks", "Fennel"]),
        recipe("pasta-pantry", "Pasta Night Pantry", ["8 oz pasta", "3 cloves garlic", "1 can tomatoes", "2 tbsp olive oil", "salt"],
          ["Pasta", "Garlic", "Canned Tomatoes", "Olive Oil", "Salt"]),
      ],
    }).expect(200);
    const { owner, g } = await household();
    for (const n of ["Pasta", "Garlic", "Canned Tomatoes", "Olive Oil"]) {
      await api().post(`/api/groups/${g.id}/cabinet`).set(owner.auth).send({ itemId: await itemId(n) }).expect(201);
    }
    const res = await search(owner, g.id, { query: "pasta night", limit: 10 });
    const titles: string[] = res.body.recipes.map((r: { title: string }) => r.title);
    expect(res.body.recipes.find((r: { title: string }) => r.title === "Pasta Night Fancy").distance)
      .toBeCloseTo(res.body.recipes.find((r: { title: string }) => r.title === "Pasta Night Pantry").distance, 6);
    expect(titles.indexOf("Pasta Night Pantry")).toBeLessThan(titles.indexOf("Pasta Night Fancy"));

    // The pure scoring: coverage counts names in either direction and ignores salt; >4 missing costs a little.
    const [best, worst] = rankByKitchenFit(
      [
        { distance: 0.3, ingredients: ["Pasta", "Saffron", "Truffle", "Capers", "Leeks", "Fennel"] },
        { distance: 0.32, ingredients: ["Pasta", "Fresh Garlic", "Canned Tomatoes", "Olive Oil", "Salt"] },
      ],
      [],
      ["Pasta", "Garlic", "Canned Tomatoes", "Olive Oil"],
    );
    expect(best).toMatchObject({ coverage: 1, missing: 0 });
    expect(best.score).toBeCloseTo(0.32 - 0.1, 6);
    expect(worst).toMatchObject({ missing: 5 });
    expect(worst.score).toBeCloseTo(0.3 - 0.1 / 6 + 0.01, 6);
  });

  it("the agent's run token can call it; outsiders get 404", async () => {
    const { owner, g } = await household();
    const startRun = vi.spyOn(agentClient, "startRun").mockResolvedValue(undefined);
    expect((await api().post(`/api/groups/${g.id}/agent/runs`).set(owner.auth).send({ prompt: "Plan" })).status).toBe(202);
    const token = (startRun.mock.calls[0][0] as AgentRunRequest).runToken;
    startRun.mockRestore();
    const res = await api().post(`/api/groups/${g.id}/agent/recipes/search`)
      .set({ Authorization: `Bearer ${token}` }).send({ query: "pasta" });
    expect(res.status).toBe(200);
    expect(res.body.recipes.map((r: { title: string }) => r.title)).toContain("Veggie Pasta");

    const outsider = await makeUser();
    expect((await search(outsider, g.id, { query: "pasta" })).status).toBe(404);
  });
});
