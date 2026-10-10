// Unit tests for the step-08 external clients. No network: fetch and DNS are stubbed.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { mapAllergens } from "../src/lib/allergens.js";
import { readCapped } from "../src/modules/products/common.js";
import { lookupOpenFoodFacts } from "../src/modules/products/openFoodFacts.js";
import {
  allowedSmartLabelUrl, fetchSmartLabelPage, isPrivateAddress, parseSmartLabel,
} from "../src/modules/products/smartlabel.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/smartlabel/${name}`, import.meta.url), "utf8");
const publicDns = async () => [{ address: "93.184.216.34" }];
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** fetch stub that returns the given responses in order and records the URLs it was called with. */
function fetchSeq(...responses: Response[]) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const r = responses.shift();
    if (!r) throw new Error("unexpected fetch");
    return r;
  });
  return Object.assign(fn as unknown as typeof fetch, { urls: () => fn.mock.calls.map((c) => String(c[0])) });
}

describe("mapAllergens", () => {
  it("maps keywords to the allergen enum", () => {
    expect(mapAllergens("Contains whey, casein and dairy")).toEqual(["milk"]);
    expect(mapAllergens("wheat")).toEqual(["wheat", "gluten"]);
    expect(mapAllergens("Eggs, shrimp, almonds, soybeans, sesame seeds, anchovies")).toEqual([
      "eggs", "fish", "shellfish", "tree_nuts", "soy", "sesame",
    ]);
  });
  it("does not confuse peanuts with tree nuts, or shellfish with fish, or eggplant with eggs", () => {
    expect(mapAllergens("peanuts")).toEqual(["peanuts"]);
    expect(mapAllergens("shellfish")).toEqual(["shellfish"]);
    expect(mapAllergens("eggplant")).toEqual([]);
    expect(mapAllergens(null)).toEqual([]);
  });
});

describe("SmartLabel URL allowlist", () => {
  it.each([
    "https://smartlabel.org/product/123",
    "https://smartlabel.generalmills.smartlabel.org/x",
    "https://smartlabel.labelinsight.com/product/1",
    "https://SMARTLABEL.ORG./p",
  ])("allows %s", (u) => expect(allowedSmartLabelUrl(u)).not.toBeNull());

  it.each([
    "http://smartlabel.org/p", // not https
    "file:///etc/passwd",
    "ftp://smartlabel.org/p",
    "https://evil.com/p",
    "https://smartlabel.org.evil.com/p",
    "https://evilsmartlabel.org/p",
    "https://user:pw@smartlabel.org/p",
    "https://smartlabel.org:8443/p",
    "https://127.0.0.1/p",
    "https://[::1]/p",
    "https://169.254.169.254/latest/meta-data",
    "javascript:alert(1)",
    "not a url",
  ])("rejects %s", (u) => expect(allowedSmartLabelUrl(u)).toBeNull());
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (a) => expect(isPrivateAddress(a)).toBe(true),
  );
  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("allows %s", (a) =>
    expect(isPrivateAddress(a)).toBe(false));
});

describe("fetchSmartLabelPage (SSRF)", () => {
  it("rejects a non-SmartLabel URL without fetching", async () => {
    const f = fetchSeq();
    await expect(fetchSmartLabelPage("https://evil.com/", { fetch: f, lookup: publicDns })).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("follows redirects within the allowlist, sending the User-Agent and redirect: manual", async () => {
    const f = fetchSeq(redirect("https://smartlabel.labelinsight.com/p/1"), redirect("/p/2", 301), html("<h1>x</h1>"));
    const out = await fetchSmartLabelPage("https://smartlabel.org/qr/abc", { fetch: f, lookup: publicDns });
    expect(f.urls()).toEqual([
      "https://smartlabel.org/qr/abc",
      "https://smartlabel.labelinsight.com/p/1",
      "https://smartlabel.labelinsight.com/p/2",
    ]);
    expect(out).toEqual({ url: "https://smartlabel.labelinsight.com/p/2", html: "<h1>x</h1>" });
    const init = vi.mocked(f).mock.calls[0][1]!;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^GrocerEZ\//);
  });

  it.each([
    "https://evil.com/steal",
    "http://smartlabel.org/p",
    "https://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://smartlabel.org:22/",
  ])("refuses a redirect to %s and never fetches it", async (target) => {
    const f = fetchSeq(redirect(target));
    await expect(fetchSmartLabelPage("https://smartlabel.org/qr", { fetch: f, lookup: publicDns })).rejects.toMatchObject({
      status: 502,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect with no Location header", async () => {
    const f = fetchSeq(new Response(null, { status: 302 }));
    await expect(fetchSmartLabelPage("https://smartlabel.org/qr", { fetch: f, lookup: publicDns })).rejects.toMatchObject({
      status: 502,
    });
  });

  it("refuses an allowlisted host that resolves to a private IP (checked on every hop)", async () => {
    const lookup = vi.fn(async (host: string) =>
      host === "smartlabel.org" ? [{ address: "93.184.216.34" }] : [{ address: "93.184.216.35" }, { address: "10.0.0.5" }]);
    const f = fetchSeq(redirect("https://internal.smartlabel.org/"));
    await expect(fetchSmartLabelPage("https://smartlabel.org/qr", { fetch: f, lookup })).rejects.toMatchObject({
      status: 502,
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("internal.smartlabel.org");
  });

  it("stops after 5 redirects", async () => {
    const f = fetchSeq(...Array.from({ length: 7 }, (_, i) => redirect(`https://smartlabel.org/${i}`)));
    await expect(fetchSmartLabelPage("https://smartlabel.org/start", { fetch: f, lookup: publicDns })).rejects.toThrow(
      /Too many redirects/,
    );
    expect(f).toHaveBeenCalledTimes(6);
  });

  it("times out", async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    await expect(
      fetchSmartLabelPage("https://smartlabel.org/qr", { fetch: hang, lookup: publicDns, timeoutMs: 20 }),
    ).rejects.toMatchObject({ status: 502, message: "SmartLabel request timed out" });
  });

  it("rejects non-2xx and oversized bodies", async () => {
    await expect(
      fetchSmartLabelPage("https://smartlabel.org/qr", { fetch: fetchSeq(html("nope", 500)), lookup: publicDns }),
    ).rejects.toMatchObject({ status: 502 });
    const big = html("x".repeat(3 * 1024 * 1024));
    await expect(fetchSmartLabelPage("https://smartlabel.org/qr", { fetch: fetchSeq(big), lookup: publicDns })).rejects.toThrow(
      /too large/,
    );
  });
});

describe("readCapped", () => {
  it("rejects a declared Content-Length over the cap and streams under it", async () => {
    await expect(readCapped(new Response("hi", { headers: { "content-length": "999" } }), 10)).rejects.toThrow(/too large/);
    expect(await readCapped(new Response("hello"), 10)).toBe("hello");
  });
});

describe("parseSmartLabel", () => {
  it("parses the generic label fixture", () => {
    const { product, gtin } = parseSmartLabel(fixture("generic-cereal.html"));
    expect(gtin).toBe("016000275279");
    expect(product).toEqual({
      source: "smartlabel",
      name: "Honey Nut Cheerios",
      brand: "Cheerios",
      gtin: "016000275279",
      servingSize: "1 cup (37g)",
      caloriesPerServing: 140,
      nutrition: {
        fat_g: 2, sat_fat_g: 0.5, trans_fat_g: 0, cholesterol_mg: 0, sodium_mg: 190, carbs_g: 29, fiber_g: 3,
        sugar_g: 12, added_sugar_g: 12, protein_g: 3,
      },
      ingredients: expect.stringMatching(/^Whole Grain Oats, Sugar/),
      allergens: ["milk", "wheat", "gluten"],
      mayContain: ["peanuts", "soy"],
      healthScore: null,
      imageUrl: "https://smartlabel.generalmills.com/img/hnc.jpg",
      categoriesTags: [],
    });
  });

  it("reads schema.org JSON-LD when present", () => {
    const page = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "Product", name: "Trix", brand: { name: "General Mills" }, gtin12: "016000123456",
        nutrition: { "@type": "NutritionInformation", calories: "160 calories", servingSize: "1 1/4 cup" } }],
    })}</script></head><body><p>Ingredients: Corn, sugar.</p></body></html>`;
    const { product } = parseSmartLabel(page);
    expect(product).toMatchObject({
      name: "Trix", brand: "General Mills", gtin: "016000123456", caloriesPerServing: 160, servingSize: "1 1/4 cup",
      ingredients: "Corn, sugar.",
    });
  });

  it("returns product null but keeps the GTIN when the page isn't a label (barcode fallback)", () => {
    expect(parseSmartLabel("<html><body><h1>Page moved</h1><p>GTIN: 00016000275279</p></body></html>")).toEqual({
      product: null,
      gtin: "00016000275279",
    });
    expect(parseSmartLabel("<html><body>nothing</body></html>")).toEqual({ product: null, gtin: null });
  });
});

describe("lookupOpenFoodFacts", () => {
  const offProduct = {
    code: "0016000275279",
    product_name: "Honey Nut Cheerios",
    brands: "Cheerios, General Mills",
    serving_size: "37 g",
    nutriments: {
      "energy-kcal_serving": 140, "energy-kcal_100g": 378, fat_serving: 2, "saturated-fat_serving": 0.5,
      sodium_serving: 0.19, sugars_serving: "12", proteins_serving: 3,
    },
    ingredients_text: "Whole grain oats, sugar",
    allergens_tags: ["en:gluten", "en:milk"],
    traces_tags: ["en:nuts", "en:peanuts"],
    nutriscore_grade: "c",
    image_front_url: "https://images.openfoodfacts.org/x.jpg",
    categories_tags: ["en:breakfast-cereals"],
  };

  it("maps an OFF product (per serving)", async () => {
    const f = fetchSeq(json({ status: 1, product: offProduct }));
    const out = await lookupOpenFoodFacts("0016000275279", { fetch: f });
    expect(f.urls()[0]).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/0016000275279\.json\?fields=/);
    expect(out?.product).toEqual({
      source: "openfoodfacts",
      name: "Honey Nut Cheerios",
      brand: "Cheerios",
      gtin: "0016000275279",
      servingSize: "37 g",
      caloriesPerServing: 140,
      nutrition: { fat_g: 2, sat_fat_g: 0.5, sodium_mg: 190, sugar_g: 12, protein_g: 3 },
      ingredients: "Whole grain oats, sugar",
      allergens: ["milk", "gluten"],
      mayContain: ["tree_nuts", "peanuts"],
      healthScore: "C",
      imageUrl: "https://images.openfoodfacts.org/x.jpg",
      categoriesTags: ["en:breakfast-cereals"],
    });
    expect(out?.raw).toMatchObject({ status: 1 });
  });

  it("falls back to per-100 g values when there is no per-serving energy", async () => {
    const f = fetchSeq(json({ status: 1, product: { product_name: "Oats", nutriments: { "energy-kcal_100g": 379, fat_100g: 6.5 } } }));
    const out = await lookupOpenFoodFacts("12345678", { fetch: f });
    expect(out?.product).toMatchObject({ servingSize: "100 g", caloriesPerServing: 379, nutrition: { fat_g: 6.5 }, gtin: "12345678" });
  });

  it("returns null for unknown barcodes", async () => {
    expect(await lookupOpenFoodFacts("12345678", { fetch: fetchSeq(json({ status: 0 }, 404)) })).toBeNull();
    expect(await lookupOpenFoodFacts("12345678", { fetch: fetchSeq(json({ status: 0, status_verbose: "product not found" })) })).toBeNull();
    expect(await lookupOpenFoodFacts("12345678", { fetch: fetchSeq(json({ status: 1, product: { product_name: "" } })) })).toBeNull();
  });

  it("rejects malformed GTINs before fetching (no path injection)", async () => {
    const f = fetchSeq();
    for (const g of ["123", "../../admin", "12345678?x=1", "1234567890123456"]) {
      await expect(lookupOpenFoodFacts(g, { fetch: f })).rejects.toMatchObject({ status: 400 });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("maps upstream failures to 502", async () => {
    await expect(lookupOpenFoodFacts("12345678", { fetch: fetchSeq(json({}, 503)) })).rejects.toMatchObject({ status: 502 });
    await expect(lookupOpenFoodFacts("12345678", { fetch: fetchSeq(new Response("<html>")) })).rejects.toMatchObject({ status: 502 });
  });
});
