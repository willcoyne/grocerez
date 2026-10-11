// Attack 4: fuzzy search (search_items). Typos, short queries, wildcards, quotes, long input, labels, index use.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { connect, rolledBack, tryQuery } from "./helpers.js";

type Row = { match: string; name: string; distance: number; similarity: number };

let c: pg.Client;
beforeAll(async () => {
  c = await connect();
});
afterAll(() => c.end());

async function search(q: string, max = 5): Promise<Row[]> {
  return (await c.query(`SELECT match, name, distance, similarity FROM search_items($1, $2)`, [q, max])).rows;
}

describe("search behaviour the plan requires (expected to hold)", () => {
  it("'cherios' suggests Cheerios; 'Cheerios!' is exact; 'CHEERIOS' is exact", async () => {
    expect((await search("cherios"))[0]).toMatchObject({ match: "suggested", name: "Cheerios" });
    expect(await search("Cheerios!")).toMatchObject([{ match: "exact", name: "Cheerios" }]);
    expect(await search("  CHEERIOS ")).toMatchObject([{ match: "exact", name: "Cheerios" }]);
  });

  it("a confirmed alias makes the next search exact", () =>
    rolledBack(async (t) => {
      await t.query(`INSERT INTO item_aliases (item_id, alias_normalized) SELECT id, normalize_item_name('Cheeri-Os') FROM items WHERE name = 'Cheerios'`);
      const r = await t.query(`SELECT match, name FROM search_items('cheeri os')`);
      expect(r.rows).toEqual([{ match: "exact", name: "Cheerios" }]);
    }));

  it.each(["%", "_", "%%", "%_%", "'", "''", '"', "\\", "' OR 1=1 --", "milk'; DROP TABLE items; --"])(
    "SQL metacharacters %j are inert (no error, no match-everything)",
    async (q) => {
      const rows = await search(q, 1000);
      expect(rows.length).toBeLessThanOrEqual(5);
      const items = await c.query(`SELECT count(*)::int AS n FROM items`);
      expect(items.rows[0].n).toBeGreaterThan(200);
    },
  );

  it("'m_lk' and 'milk%' don't behave like LIKE patterns", async () => {
    expect((await search("milk%"))[0]).toMatchObject({ match: "exact", name: "Milk" }); // % is stripped by normalize
    expect((await search("m_lk")).some((r) => r.name === "Silk")).toBe(false);
  });

  it.each(["m", "mi", "mil", "pb", "a", "&", "1", "7"])("1–3 character query %j doesn't error and returns ≤ 5 rows", async (q) => {
    expect((await search(q)).length).toBeLessThanOrEqual(5);
  });

  it("'milk' is exact and 'silk' does not suggest Milk", async () => {
    expect(await search("milk")).toMatchObject([{ match: "exact", name: "Milk" }]);
    expect((await search("silk")).filter((r) => r.match === "suggested")).toEqual([]);
  });

  it("very long input (10 kB, 1 MB) returns no rows and no error (levenshtein's 255-char limit is not reached)", async () => {
    expect(await search("cheerios ".repeat(1200))).toEqual([]);
    expect(await search("x".repeat(1_000_000))).toEqual([]);
    expect(await search("a".repeat(199) + "b")).toEqual([]);
  });

  it("empty / punctuation-only / NULL query returns nothing", async () => {
    expect(await search("")).toEqual([]);
    expect(await search("!!!")).toEqual([]);
    expect((await c.query(`SELECT * FROM search_items(NULL)`)).rows).toEqual([]);
  });

  /** ~6,000 realistic store-brand items + one alias each, inside the caller's (rolled back) transaction. */
  async function bigCatalog(t: pg.Client) {
    await t.query(`
      INSERT INTO items (name, normalized_name, category)
      SELECT n, normalize_item_name(n), 'other' FROM (
        SELECT DISTINCT b || ' ' || i.name || ' ' || g AS n
        FROM items i,
             unnest(ARRAY['Organic','Great Value','Kroger','Kirkland','Simple Truth','Market Pantry','365']) b,
             generate_series(1, 4) g) x
      ON CONFLICT DO NOTHING`);
    await t.query(`INSERT INTO item_aliases (item_id, alias_normalized)
                   SELECT id, 'alias ' || normalized_name FROM items WHERE normalized_name ~ ' [0-9]$'
                   ON CONFLICT DO NOTHING`);
    await t.query(`ANALYZE items; ANALYZE item_aliases`);
    const n = await t.query(`SELECT count(*)::int AS n FROM items`);
    expect(n.rows[0].n).toBeGreaterThan(5000);
  }

  it("search_items stays under 20 ms with 5,000+ items", () =>
    rolledBack(async (t) => {
      await bigCatalog(t);
      await t.query(`SELECT * FROM search_items('warm up')`);
      const t0 = performance.now();
      const r = await t.query(`SELECT * FROM search_items('cherios')`);
      const ms = performance.now() - t0;
      expect(r.rows[0]).toMatchObject({ match: "suggested", name: "Cheerios" });
      expect(ms).toBeLessThan(20);
    }));

  it("[DB-15] EXPLAIN ANALYZE of the candidate query uses the GIN trigram indexes with 5,000+ items", () =>
    rolledBack(async (t) => {
      await bigCatalog(t);
      await t.query(`SET LOCAL pg_trgm.similarity_threshold = 0.3`);
      // The function's candidate query, written out so EXPLAIN can see it (plpgsql hides inner plans).
      const plan = await t.query(`
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT it.id, it.normalized_name FROM items it WHERE it.normalized_name % 'cherio'
        UNION ALL
        SELECT a.item_id, a.alias_normalized FROM item_aliases a WHERE a.alias_normalized % 'cherio'`);
      const text = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
      expect({ items: text.includes("items_name_trgm"), aliases: text.includes("item_aliases_trgm") }).toEqual({
        items: true,
        aliases: true,
      });
    }));

  it("negative max_results errors instead of silently misbehaving (backend must clamp it)", async () => {
    await c.query("BEGIN");
    try {
      const err = await tryQuery(c, `SELECT * FROM search_items('mlk', -1)`);
      expect(err?.message).toMatch(/LIMIT must not be negative/);
    } finally {
      await c.query("ROLLBACK");
    }
  });
});

describe("defects", () => {
  // backend/04 step 2.4: "The best result within the distance threshold gives match:'suggested';
  // any other results give match:'none' and are returned as 'similar' options."
  it("[DB-05] only the best candidate is labelled 'suggested' ('Peanut buter')", async () => {
    const rows = await search("Peanut buter");
    expect(rows[0]).toMatchObject({ name: "Peanut Butter", match: "suggested" });
    const others = rows.slice(1);
    expect(others.length).toBeGreaterThan(0);
    expect(
      others.filter((r) => r.match === "suggested").map((r) => `${r.name} (distance ${r.distance})`),
      "far-away candidates are labelled 'suggested' too",
    ).toEqual([]);
  });

  it("[DB-05] a candidate 12 edits away is never 'suggested'", async () => {
    const far = (await search("Peanut buter")).filter((r) => r.match === "suggested" && r.distance > 2);
    expect(far.map((r) => `${r.name} (${r.distance})`)).toEqual([]);
  });

  it.each([
    ["pea", "Pears"], // Frozen Peas exists, but the 4-letter fruit wins
    ["batter", "Butter"],
    ["bitter", "Butter"],
  ])("[DB-11] %j is not 'suggested' as %j (false positive)", async (q, wrong) => {
    const rows = await search(q);
    expect(rows.filter((r) => r.match === "suggested" && r.name === wrong)).toEqual([]);
  });

  it.each([
    ["mlik", "Milk"],
    ["oero", "Oreos"],
  ])("[DB-11] the transposition %j at least lists %j as a similar option", async (q, want) => {
    const rows = await search(q);
    expect(rows.map((r) => r.name)).toContain(want);
  });
});
