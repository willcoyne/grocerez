import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { allergensFromOffTags, allergensInText } from "../src/lib/allergens.js";
import { http } from "../src/lib/http.js";
import { normalizeGtin, offCode } from "../src/lib/openfoodfacts.js";
import { canonicalSmartLabelUrl, isSmartLabelHost, parseSmartLabel } from "../src/lib/smartlabel.js";
import { linkItem } from "../src/modules/products/service.js";
import { api, itemId, makeUser } from "./helpers.js";

const fixture = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8");
const OFF_CHEERIOS = fixture("openfoodfacts/0016000275287.json");
const GM_SHELL = fixture("smartlabel/generalmills-shell-00016000275287.html");

afterEach(() => vi.restoreAllMocks());

/** Stubs the network: a map of URL (exact or prefix) → Response factory. Unmatched URLs fail the test. */
function stubNet(routes: Record<string, () => Response>) {
  return vi.spyOn(http, "fetch").mockImplementation(async (url: string) => {
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return routes[key]();
  });
}
const json = (body: string, status = 200) => () => new Response(body, { status, headers: { "content-type": "application/json" } });
const html = (body: string, status = 200) => () => new Response(body, { status, headers: { "content-type": "text/html" } });
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

describe("08 parsers and mapping", () => {
  it("General Mills SmartLabel shell (real saved page) yields only the GTIN → barcode fallback", () => {
    const p = parseSmartLabel(GM_SHELL, "https://smartlabel.generalmills.com/00016000275287");
    expect(p).toMatchObject({ template: "gtin-only", gtin: "00016000275287", name: null });
  });

  it("JSON-LD template parser", () => {
    const p = parseSmartLabel(fixture("smartlabel/jsonld-synthetic.html"), "https://smartlabel.org/p/1");
    expect(p).toMatchObject({
      template: "jsonld", gtin: "012345678905", name: "Peanut Butter Crunch Bars", brand: "Demo Foods",
      servingSize: "1 bar (40g)", calories: 190, allergens: ["peanuts", "soy"], mayContain: ["milk", "tree_nuts"],
    });
    expect(p.nutrition).toMatchObject({ fat_g: 9, sodium_mg: 150, protein_g: 6 });
    expect(p.ingredients).toMatch(/^Peanuts, rolled oats/);
  });

  it("sections template parser", () => {
    const p = parseSmartLabel(fixture("smartlabel/sections-synthetic.html"), "https://smartlabel.labelinsight.com/x");
    expect(p).toMatchObject({
      template: "sections", gtin: "00099999000017", name: "Whole Milk Greek Yogurt, Honey", brand: "Demo Dairy Co.",
      calories: 170, servingSize: "1 container (150g)", allergens: ["milk"], mayContain: [],
    });
    expect(p.nutrition).toEqual({ fat_g: 6, sat_fat_g: 4, sodium_mg: 65, carbs_g: 18, sugar_g: 16, protein_g: 12 });
  });

  it("allergen keyword mapping", () => {
    expect(allergensInText("Contains: Wheat, Milk and Soy")).toEqual(["gluten", "milk", "soy", "wheat"]);
    expect(allergensInText("whey protein, casein")).toEqual(["milk"]);
    expect(allergensInText("peanut butter, coconut milk, nutmeg")).toEqual(["peanuts"]);
    expect(allergensInText("almonds and cashews")).toEqual(["tree_nuts"]);
    expect(allergensInText("shrimp, sesame oil, eggs")).toEqual(["eggs", "sesame", "shellfish"]);
    expect(allergensInText("rice flour, buckwheat")).toEqual([]);
    expect(allergensInText("")).toEqual([]);
    expect(allergensFromOffTags(["en:gluten", "en:Corn", "en:milk", "en:nuts", "en:crustaceans", "fr:soybeans"])).toEqual([
      "gluten", "milk", "shellfish", "soy", "tree_nuts",
    ]);
  });

  it("GTIN normalization and host allowlist", () => {
    expect(normalizeGtin("016000275287")).toBe("00016000275287");
    expect(normalizeGtin("0016000275287")).toBe("00016000275287");
    expect(normalizeGtin("12345")).toBeNull();
    expect(offCode("00016000275287")).toBe("0016000275287");
    expect(isSmartLabelHost("smartlabel.generalmills.com")).toBe(true);
    expect(isSmartLabelHost("foo.smartlabel.org")).toBe(true);
    expect(isSmartLabelHost("smartlabel.org.evil.com")).toBe(false);
    expect(isSmartLabelHost("evilsmartlabel.org")).toBe(false);
    expect(canonicalSmartLabelUrl("http://smartlabel.generalmills.com/00016000275287#x")).toBe("https://smartlabel.generalmills.com/00016000275287");
    expect(() => canonicalSmartLabelUrl("https://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => canonicalSmartLabelUrl("file:///etc/passwd")).toThrow();
    expect(() => canonicalSmartLabelUrl("https://user:pw@smartlabel.org/")).toThrow();
  });
});

describe("08 linking a product to a catalog item", () => {
  it("full name, then brand, then word runs (rightmost first)", async () => {
    const u = await makeUser();
    expect(await linkItem("Toasted Whole Grain Cheerios Box", "pantry", u.id, "General Mills")).toBe(await itemId("Cheerios"));
    expect(await linkItem("oreo cookies shelf", "snacks", u.id, "Oreo")).toBe(await itemId("Oreos"));
    expect(await linkItem("Milk", "dairy", u.id, null)).toBe(await itemId("Milk"));
    const created = await linkItem("Zzyzx Fizz Drink 12pk", "beverages", u.id, "Zzyzx");
    const row = await prisma.item.findUniqueOrThrow({ where: { id: created } });
    expect(row).toMatchObject({ name: "Zzyzx Fizz Drink 12pk", category: "beverages", createdBy: u.id });
  });
});

describe("08 POST /products/scan", () => {
  it("a plain UPC returns Open Food Facts data linked to the catalog item; the second scan is served from the cache", async () => {
    const u = await makeUser();
    const net = stubNet({ "https://world.openfoodfacts.org/api/v2/product/0016000275287.json": json(OFF_CHEERIOS) });
    const res = await api().post("/api/products/scan").set(u.auth).send({ gtin: "016000275287" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      gtin: "00016000275287", name: "Cheerios", brand: "Cheerios", caloriesPerServing: 140, servingSize: "39g",
      allergens: ["gluten"], mayContain: [], healthScore: "C", source: "openfoodfacts", itemId: await itemId("Cheerios"),
    });
    expect(res.body.nutrition).toMatchObject({ basis: "serving", fat_g: 2.5, sodium_mg: 190, protein_g: 5 });
    expect(res.body.imageUrl).toMatch(/^https:\/\/images\.openfoodfacts\.org\//);
    const call = net.mock.calls[0];
    expect((call[1]?.headers as Record<string, string>)["User-Agent"]).toMatch(/^GrocerEZ\/0\.1/);

    const again = await api().post("/api/products/scan").set(u.auth).send({ gtin: "0016000275287" });
    expect(again.body.id).toBe(res.body.id);
    expect(net).toHaveBeenCalledTimes(1);
  });

  it("a real SmartLabel QR (General Mills) falls back to the barcode path via the page's GTIN, then caches by URL", async () => {
    const u = await makeUser();
    await prisma.product.deleteMany({ where: { gtin: "00016000275287" } });
    const net = stubNet({
      "https://smartlabel.generalmills.com/00016000275287": html(GM_SHELL),
      "https://world.openfoodfacts.org/api/v2/product/0016000275287.json": json(OFF_CHEERIOS),
    });
    const res = await api().post("/api/products/scan").set(u.auth).send({ qrUrl: "http://smartlabel.generalmills.com/00016000275287" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      smartlabelUrl: "https://smartlabel.generalmills.com/00016000275287", gtin: "00016000275287", caloriesPerServing: 140,
      allergens: ["gluten"],
    });
    const again = await api().post("/api/products/scan").set(u.auth).send({ qrUrl: "https://smartlabel.generalmills.com/00016000275287" });
    expect(again.body.id).toBe(res.body.id);
    expect(net).toHaveBeenCalledTimes(2);
  });

  it("a SmartLabel page with label data is parsed directly (source smartlabel) and linked or created as an item", async () => {
    const u = await makeUser();
    stubNet({ "https://smartlabel.org/p/demo-bar": html(fixture("smartlabel/jsonld-synthetic.html")) });
    const res = await api().post("/api/products/scan").set(u.auth).send({ qrUrl: "https://smartlabel.org/p/demo-bar" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "smartlabel", name: "Peanut Butter Crunch Bars", gtin: "00012345678905", allergens: ["peanuts", "soy"] });
    expect(res.body.item.name).toBeTruthy();
  });

  it("rejects non-SmartLabel hosts and redirects that leave the allowlist (SSRF)", async () => {
    const u = await makeUser();
    const net = stubNet({ "https://smartlabel.org/r": redirect("https://evil.example.com/steal") });
    for (const qrUrl of ["https://evil.example.com/x", "http://169.254.169.254/latest/meta-data/", "https://localhost/", "javascript:alert(1)"]) {
      const res = await api().post("/api/products/scan").set(u.auth).send({ qrUrl });
      expect(res.status, qrUrl).toBe(400);
      expect(res.body.error.code).toBe("HOST_NOT_ALLOWED");
    }
    expect(net).not.toHaveBeenCalled();
    const res = await api().post("/api/products/scan").set(u.auth).send({ qrUrl: "https://smartlabel.org/r" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("HOST_NOT_ALLOWED");
    expect(net).toHaveBeenCalledTimes(1);
    expect(net.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("validation: exactly one of qrUrl / gtin; unknown barcode → 404; upstream down → 502", async () => {
    const u = await makeUser();
    expect((await api().post("/api/products/scan").set(u.auth).send({})).status).toBe(400);
    expect((await api().post("/api/products/scan").set(u.auth).send({ gtin: "12345678", qrUrl: "https://smartlabel.org/" })).status).toBe(400);
    expect((await api().post("/api/products/scan").set(u.auth).send({ gtin: "12ab" })).status).toBe(400);
    stubNet({ "https://world.openfoodfacts.org/api/v2/product/": json(JSON.stringify({ status: 0, status_verbose: "product not found" })) });
    const nf = await api().post("/api/products/scan").set(u.auth).send({ gtin: "9999999999994" });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe("PRODUCT_NOT_FOUND");
    vi.restoreAllMocks();
    vi.spyOn(http, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const down = await api().post("/api/products/scan").set(u.auth).send({ gtin: "9999999999987" });
    expect(down.status).toBe(502);
  });
});
