import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { http } from "../src/lib/http.js";
import { clearSemanticIngredientCache } from "../src/lib/semanticIngredient.js";
import { recipeIndex } from "../src/modules/agent/recipes.js";
import { UNVERIFIED_REASON, catalogMatch, safety } from "../src/modules/agent/safety.js";
import { api, makeGroup, makeUser } from "./helpers.js";

// Semantic ingredient verification + precomputed recipes.unverified. Akamai is faked at http.fetch (4-d vectors):
// "shiitake" sits on the same axis as the catalog item "Fungus Medley", "gravel" is far from everything.

const HOST = "https://semantic.test/";
const MODEL = "sem-test-model";
const saved = { key: config.AKAMAI_API_KEY, base: config.AKAMAI_BASE_URL, model: config.AKAMAI_EMBEDDING_MODEL };
const FUNGUS = "Fungus Medley";

const fakeVector = (text: string) => {
  const t = text.toLowerCase();
  if (/shiitake|fungus/.test(t)) return [1, 0, 0, 0.05];
  if (/gravel/.test(t)) return [0, 0, 1, 0.05];
  if (/stew/.test(t)) return [0, 1, 0, 0.05];
  return [0.2, 0.2, 0.2, 1];
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
  config.AKAMAI_EMBEDDING_MODEL = MODEL;
};

const recipe = (slug: string, title: string, ingredients: string[]) => ({
  url: `${HOST}${slug}`, site: "Semantic Test", title, imageUrl: null, minutes: 30, servings: 4,
  ingredientLines: ingredients.map((i) => `1 ${i}`), ingredients, course: [] as string[],
});
const unverifiedOf = async (slug: string) =>
  (await prisma.$queryRaw<{ u: string[] }[]>`SELECT unverified AS u FROM recipes WHERE url = ${HOST + slug}`)[0].u;

async function household(allergens?: string[]) {
  const owner = await makeUser({ displayName: "Owner", allergens });
  return { owner, g: await makeGroup(owner) };
}

beforeAll(async () => {
  await prisma.$executeRaw`DELETE FROM recipes WHERE url LIKE ${HOST + "%"}`;
  await prisma.$executeRaw`DELETE FROM items WHERE name = ${FUNGUS}`;
  await prisma.$executeRaw`
    INSERT INTO items (name, normalized_name, category, default_allergens, embedding, embedding_model, embedded_at)
    VALUES (${FUNGUS}, 'fungus medley', 'produce', '{soy}'::allergen[], '[1,0,0,0.05]'::vector, ${MODEL}, now())`;
  vi.spyOn(http, "fetch").mockImplementation(fakeAkamai);
});
beforeEach(() => {
  configure();
  clearSemanticIngredientCache();
  embedCalls.length = 0;
});
afterAll(async () => {
  vi.restoreAllMocks();
  Object.assign(config, { AKAMAI_API_KEY: saved.key, AKAMAI_BASE_URL: saved.base, AKAMAI_EMBEDDING_MODEL: saved.model });
  await prisma.$executeRaw`DELETE FROM recipes WHERE url LIKE ${HOST + "%"}`;
  await prisma.$executeRaw`DELETE FROM items WHERE name = ${FUNGUS}`;
});

describe("semantic ingredient verification", () => {
  it("a near catalog item verifies the ingredient and supplies its allergens and category", async () => {
    const m = await catalogMatch("Shiitake Caps");
    expect(m.verified).toMatchObject({ name: FUNGUS, category: "produce", defaultAllergens: ["soy"] });

    const { g } = await household(["milk"]);
    const [res] = (await safety.check(g.id, [{ title: "Stir fry", ingredients: ["Shiitake Caps"] }])).meals;
    expect(res.unknown).toEqual([]);
    expect(res.problems).toEqual([]); // milk household: soy from the catalog doesn't matter
    const soy = await household(["soy"]);
    const [soyRes] = (await safety.check(soy.g.id, [{ title: "Stir fry", ingredients: ["Shiitake Caps"] }])).meals;
    expect(soyRes.problems.map((p) => p.reason)).toContain("contains soy"); // the matched item's allergens apply
    expect(soyRes.unknown).toEqual([]);
  });

  it("batches embedding calls and caches results in-process", async () => {
    await Promise.all(["Shiitake A", "Shiitake B", "Gravel A"].map((n) => catalogMatch(n)));
    expect(embedCalls).toHaveLength(1);
    expect(embedCalls[0]).toHaveLength(3);
    await catalogMatch("Shiitake A");
    expect(embedCalls).toHaveLength(1);
  });

  it("a far match stays unverified and fails in an allergy household (but not a diet-only one)", async () => {
    const { g } = await household(["milk"]);
    const [res] = (await safety.check(g.id, [{ title: "Rubble", ingredients: ["Gravel Dust"] }])).meals;
    expect(res.unknown).toEqual(["Gravel Dust"]);
    expect(res.passes).toBe(false);
    expect(res.problems.map((p) => p.reason)).toContain(UNVERIFIED_REASON);
    const none = await household();
    expect((await safety.check(none.g.id, [{ title: "Rubble", ingredients: ["Gravel Dust"] }])).meals[0].passes).toBe(true);
  });

  it("without embeddings it behaves as before (unverified)", async () => {
    config.AKAMAI_API_KEY = undefined;
    config.AKAMAI_BASE_URL = undefined;
    expect((await catalogMatch("Shiitake Caps")).verified).toBeNull();
  });
});

describe("recipes.unverified", () => {
  it("ingest stores the ingredients that stay unverifiable", async () => {
    const res = await recipeIndex.ingest([
      recipe("stew-a", "Shiitake Gravel Stew", ["Shiitake Caps", "Gravel Dust"]),
      recipe("stew-b", "Shiitake Stew", ["Shiitake Caps"]),
    ]);
    expect(res.upserted).toBe(2);
    expect(await unverifiedOf("stew-a")).toEqual(["Gravel Dust"]);
    expect(await unverifiedOf("stew-b")).toEqual([]);
    const [{ allergens }] = await prisma.$queryRaw<{ allergens: string[] }[]>`
      SELECT allergens::text[] AS allergens FROM recipes WHERE url = ${HOST + "stew-b"}`;
    expect(allergens).toEqual(["soy"]); // from the semantically matched item
  });

  it("the backfill computes rows that were never verified", async () => {
    await prisma.$executeRaw`UPDATE recipes SET unverified = '{}', verified_at = NULL WHERE url = ${HOST + "stew-a"}`;
    const res = await recipeIndex.verifyMissing();
    expect(res.done).toBeGreaterThanOrEqual(1);
    expect(await unverifiedOf("stew-a")).toEqual(["Gravel Dust"]);
  });

  it("search skips recipes with unverified ingredients only for allergy households (normal and browse)", async () => {
    const search = (u: Awaited<ReturnType<typeof household>>, body: Record<string, unknown>) =>
      api().post(`/api/groups/${u.g.id}/agent/recipes/search`).set(u.owner.auth).send(body);
    const titles = (r: { body: { recipes: { title: string }[] } }) => r.body.recipes.map((x) => x.title).sort();
    const stew = { query: "stew", limit: 10 };
    const browse = { query: "(ignored)", browse: true, mustUse: ["Shiitake Caps"], limit: 10 };

    const allergic = await household(["milk"]);
    expect(titles(await search(allergic, stew))).toEqual(["Shiitake Stew"]);
    expect(titles(await search(allergic, browse))).toEqual(["Shiitake Stew"]);

    const free = await household();
    expect(titles(await search(free, stew))).toEqual(["Shiitake Gravel Stew", "Shiitake Stew"]);
    expect(titles(await search(free, browse))).toEqual(["Shiitake Gravel Stew", "Shiitake Stew"]);
  });
});
