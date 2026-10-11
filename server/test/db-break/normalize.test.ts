// Attack 3: normalize_item_name(). Fixture agreement, plan rules, unicode, whitespace, plurals, idempotency.
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { connect, tryQuery } from "./helpers.js";

const fixture: { cases: { input: string; expected: string }[] } = JSON.parse(
  readFileSync(new URL("../../prisma/fixtures/normalize-cases.json", import.meta.url), "utf8"),
);

let c: pg.Client;
beforeAll(async () => {
  c = await connect();
});
afterAll(() => c.end());

async function norm(input: string): Promise<string> {
  return (await c.query(`SELECT normalize_item_name($1) AS n`, [input])).rows[0].n;
}

describe("SQL normalize_item_name vs the shared fixture", () => {
  it.each(fixture.cases)("normalize($input) = $expected, and is idempotent", async ({ input, expected }) => {
    const n = await norm(input);
    expect(n).toBe(expected);
    expect(await norm(n)).toBe(n);
  });

  // The plan (database/04 step 3, backend/04 step 1) requires lib/normalize.ts to agree with SQL on this fixture.
  const tsPath = new URL("../../src/lib/normalize.ts", import.meta.url);
  it.skipIf(!existsSync(tsPath))("TypeScript normalize() agrees with SQL on every fixture case", async () => {
    const mod = await import(tsPath.href);
    for (const { input } of fixture.cases) expect(mod.normalize(input), input).toBe(await norm(input));
  });
  it.todo("PENDING: server/src/lib/normalize.ts does not exist yet (backend not built); re-run this file once it does");
});

describe("plan rules (expected to hold)", () => {
  it.each([
    ["  Milk  ", "milk"],
    ["Milk   Whole", "milk whole"], // NBSP and em space are whitespace
    ["milk\n\nwhole", "milk whole"],
    ["Hummus", "hummus"],
    ["Glasses", "glass"],
    ["Cheeses", "cheese"],
    ["s", "s"],
    ["...", ""],
    ["", ""],
    ["🥛 Milk", "milk"],
    ["Café", "cafe"],
    ["%_milk_%", "milk"],
    ["Robert'); DROP TABLE items;--", "robert drop table item"],
  ])("normalize(%j) = %j", async (input, expected) => {
    expect(await norm(input)).toBe(expected);
  });

  it("returns NULL for NULL (STRICT) and survives very long input", async () => {
    expect((await c.query(`SELECT normalize_item_name(NULL) AS n`)).rows[0].n).toBeNull();
    const r = await c.query(`SELECT length(normalize_item_name(repeat('Cheerios! ', 100000))) AS n`);
    expect(r.rows[0].n).toBe(899_998); // 100000 × "cheerios " (9 chars), trimmed, last word de-pluralized
  });

  it("is idempotent on 5,000 random strings (ASCII + accents + punctuation + plural endings)", async () => {
    const r = await c.query(`
      WITH alphabet AS (SELECT 'abcdeoszhxu  &''-.!ÉéñÖ’es'::text AS a),
      samples AS (
        SELECT (SELECT string_agg(substr(a, 1 + floor(random() * length(a))::int, 1), '')
                FROM alphabet, generate_series(1, 1 + (g % 14))) AS s
        FROM generate_series(1, 5000) g)
      SELECT s, normalize_item_name(s) AS n1, normalize_item_name(normalize_item_name(s)) AS n2
      FROM samples WHERE normalize_item_name(s) IS DISTINCT FROM normalize_item_name(normalize_item_name(s))`);
    expect(r.rows).toEqual([]);
  });

  it("can't be used to store an item whose name normalizes to empty", async () => {
    await c.query("BEGIN");
    try {
      const err = await tryQuery(c, `INSERT INTO items (name, normalized_name) VALUES ('!!!', normalize_item_name('!!!'))`);
      expect(err?.code).toBe("23514");
    } finally {
      await c.query("ROLLBACK");
    }
  });
});

describe("defects", () => {
  // Plan database/04 step 3: lowercase → trim → collapse whitespace → strip PUNCTUATION except &.
  // Letters are not punctuation, but every non-ASCII letter outside the fixed translate() table is turned into a space.
  it.each([
    ["Ｍｉｌｋ", "milk"], // full-width (CJK IME / some iOS keyboards)
    ["ﬁg Newtons", "fig newton"], // ligature from copy-pasted recipes
    ["Weißbier", "weissbier"],
    ["Œufs", "oeufs"],
    ["Молоко", "молоко"], // Cyrillic: must not vanish
    ["豆腐", "豆腐"], // CJK: must not vanish
  ])("[DB-06] normalize(%j) keeps the letters (expected %j)", async (input, expected) => {
    expect(await norm(input)).toBe(expected);
  });

  it("[DB-14] '&' spacing doesn't create a second normalized name ('Mac&Cheese' vs 'Mac & Cheese', \"M & M's\" vs \"M&M's\")", async () => {
    expect(await norm("Mac&Cheese")).toBe(await norm("Mac & Cheese"));
    expect(await norm("M & M's")).toBe(await norm("M&M's"));
  });
});
