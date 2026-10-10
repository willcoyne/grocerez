import { describe, expect, it, vi } from "vitest";
import { estimateExpiration } from "../src/lib/expiration.js";
import { fetchRecalls, recallLink } from "../src/modules/recalls/openfda.js";
import { brandAppears, matchRecalls, similarity, strictWordSimilarity } from "../src/modules/recalls/match.js";

const day = 86_400_000;
const bought = new Date("2026-10-01T12:00:00Z");

describe("estimateExpiration", () => {
  it("uses item shelf life first, then category, else null", () => {
    expect(estimateExpiration({ shelfLifeDays: 14, category: "dairy" }, bought)?.getTime()).toBe(bought.getTime() + 14 * day);
    expect(estimateExpiration({ category: "dairy" }, bought)?.getTime()).toBe(bought.getTime() + 10 * day);
    expect(estimateExpiration({ shelfLifeDays: null, category: "seafood" }, bought)?.getTime()).toBe(bought.getTime() + 2 * day);
    expect(estimateExpiration({ category: "household" }, bought)).toBeNull();
    expect(estimateExpiration({ category: "other" }, bought)).toBeNull();
    expect(estimateExpiration({}, bought)).toBeNull();
  });
});

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  recall_number: `F-${n}-2026`,
  product_description: `Product ${n}`,
  reason_for_recall: "Listeria",
  classification: "Class I",
  recalling_firm: "Acme",
  distribution_pattern: "Nationwide",
  report_date: "20261005",
  status: "Ongoing",
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchRecalls", () => {
  const since = new Date("2026-09-10T00:00:00Z");
  const until = new Date("2026-10-10T00:00:00Z");

  it("builds the query, pages with skip, and maps fields", async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => row(i)), [row(100), { bad: true }]];
    const f = vi.fn(async (url: string) => {
      const skip = Number(new URL(url).searchParams.get("skip"));
      return json({ meta: { results: { total: 102 } }, results: pages[skip / 100] });
    });
    const out = await fetchRecalls({ since, until, apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(2);
    const first = f.mock.calls[0][0];
    expect(first).toContain("search=report_date:[20260910+TO+20261010]");
    expect(first).toContain("limit=100&skip=0");
    expect(first).toContain("api_key=k");
    expect(f.mock.calls[1][0]).toContain("skip=100");
    expect(out).toHaveLength(101); // malformed row dropped
    expect(out[100]).toMatchObject({
      source: "openfda",
      externalId: "F-100-2026",
      reason: "Listeria",
      classification: "Class I",
      firm: "Acme",
      distribution: "Nationwide",
      status: "Ongoing",
      reportDate: new Date("2026-10-05T00:00:00Z"),
    });
  });

  it("treats 404 as no results and throws on other errors", async () => {
    const notFound = vi.fn(async () => json({ error: { code: "NOT_FOUND" } }, 404));
    expect(await fetchRecalls({ since, until, fetch: notFound as unknown as typeof fetch })).toEqual([]);
    const boom = vi.fn(async () => json({}, 500));
    await expect(fetchRecalls({ since, until, fetch: boom as unknown as typeof fetch })).rejects.toThrow("openFDA 500");
  });

  it("recallLink points at the openFDA record", () => {
    expect(recallLink("F-1-2026")).toBe('https://api.fda.gov/food/enforcement.json?search=recall_number:"F-1-2026"');
  });
});

describe("matching", () => {
  it("similarity mirrors pg_trgm", () => {
    expect(similarity("word", "word")).toBe(1);
    expect(similarity("word", "two words")).toBeCloseTo(0.363636, 5); // pg_trgm docs value
    expect(similarity("", "x")).toBe(0);
  });

  it("strictWordSimilarity finds a short name inside a long description", () => {
    const desc = "Fresh Valley Organic Baby Spinach, 5 oz clamshell, UPC 0123456789";
    expect(strictWordSimilarity("baby spinach", desc)).toBe(1);
    expect(similarity("baby spinach", desc)).toBeLessThan(0.35); // why whole-string similarity is not used
  });

  it("brandAppears is whole-word and case-insensitive", () => {
    expect(brandAppears("Fresh Valley", "FRESH VALLEY organic spinach")).toBe(true);
    expect(brandAppears("Valley", "Valleyview spinach")).toBe(false);
    expect(brandAppears("", "anything")).toBe(false);
  });

  it("matchRecalls applies threshold and brand gate", () => {
    const recalls = [{ id: "r1", productDescription: "Fresh Valley Organic Baby Spinach 5 oz" }];
    const items = [
      { id: "c1", groupId: "g", itemName: "Spinach", brand: "Fresh Valley", productName: "Organic Baby Spinach" },
      { id: "c2", groupId: "g", itemName: "Spinach", brand: "Other Farms", productName: "Baby Spinach" }, // brand missing
      { id: "c3", groupId: "g", itemName: "spinch", aliases: ["baby spinach"] }, // alias hits, no brand known
      { id: "c4", groupId: "g", itemName: "Whole Milk" },
    ];
    const out = matchRecalls(recalls, items);
    expect(out.map((m) => m.cabinetItemId)).toEqual(["c1", "c3"]);
    expect(out[0]).toMatchObject({ recallId: "r1", groupId: "g", score: 1 });
  });
});
