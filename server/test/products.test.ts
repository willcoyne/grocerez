// POST /api/products/scan against the real app + local Postgres. No network: global fetch, DNS and S3 are stubbed.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { Product } from "../src/contracts/products.js";
import { prisma } from "../src/db.js";
import { putObject } from "../src/lib/s3.js";
import { fetchProductImage } from "../src/modules/products/image.js";
import { CACHE_MS, guessCategory } from "../src/modules/products/service.js";
import { cleanupUsers, makeUser } from "./helpers.js";

const dns = vi.hoisted(() => ({ address: "93.184.216.34" }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: dns.address }]) }));
vi.mock("../src/lib/s3.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/s3.js")>()),
  putObject: vi.fn(async () => {}),
  presignGet: vi.fn(async (key: string) => `https://get.test/${key}`),
}));

// URL -> response factory. Anything unrouted fails loudly, so a test can never reach the real network.
let routes: Record<string, () => Response> = {};
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  const route = routes[url] ?? routes[url.split("?")[0]];
  if (!route) throw new Error(`unexpected fetch ${url}`);
  return route();
});
vi.stubGlobal("fetch", fetchMock);

const offUrl = (gtin: string) => `https://world.openfoodfacts.org/api/v2/product/${gtin}.json`;
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const html = (body: string) => () => new Response(body, { headers: { "content-type": "text/html" } });
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });

const tag = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 8); // letters only, so names stay distinct items
const newGtin = () => `9${String(randomInt(1e11)).padStart(12, "0")}`; // 13 digits, starts with 9: never a real cached one
const IMG = "https://images.openfoodfacts.org/images/products/x/front.jpg";

function offProduct(gtin: string, name: string, extra: object = {}) {
  return {
    status: 1,
    product: {
      code: gtin,
      product_name: name,
      brands: "Testbrand",
      nutriments: { "energy-kcal_serving": 120, fat_serving: 2, sodium_serving: 0.2 },
      serving_size: "30 g",
      ingredients_text: "Oats, sugar, milk powder",
      allergens_tags: ["en:milk"],
      traces_tags: ["en:nuts"],
      nutriscore_grade: "b",
      image_front_url: IMG,
      categories_tags: ["en:plant-based-foods-and-beverages", "en:breakfast-cereals"],
      ...extra,
    },
  };
}

let user: Awaited<ReturnType<typeof makeUser>>;
const gtins: string[] = [];
const urls: string[] = [];

beforeAll(async () => {
  user = await makeUser();
});
beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  vi.mocked(putObject).mockClear();
  dns.address = "93.184.216.34";
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { OR: [{ gtin: { in: gtins } }, { smartlabelUrl: { in: urls } }] } });
  await prisma.item.deleteMany({ where: { createdBy: user.id } });
  await cleanupUsers();
  await prisma.$disconnect();
});

const scan = (body: object, auth = user.auth) => request(app).post("/api/products/scan").set(auth).send(body);

describe("POST /api/products/scan: validation", () => {
  it("requires auth", async () => {
    expect((await request(app).post("/api/products/scan").send({ gtin: "12345678" })).status).toBe(401);
  });

  it.each([[{}], [{ gtin: "12345678", qrUrl: "https://smartlabel.org/x" }], [{ gtin: "1234" }], [{ gtin: "12345678x" }], [{ gtin: "12345678", extra: 1 }]])(
    "rejects %j with 400",
    async (body) => {
      const res = await scan(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["https://evil.example/x", "http://smartlabel.org/x", "https://127.0.0.1/x", "https://smartlabel.org.evil.com/"])(
    "refuses non-SmartLabel qrUrl %s without fetching",
    async (qrUrl) => {
      const res = await scan({ qrUrl });
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/products/scan: barcode (Open Food Facts)", () => {
  it("returns OFF data, links a new catalog item, copies the image to S3, then serves the cache", async () => {
    const gtin = newGtin();
    gtins.push(gtin);
    const name = `Crunchos ${tag()}`;
    routes[offUrl(gtin)] = json(offProduct(gtin, name));
    routes[IMG] = jpeg;

    const res = await scan({ gtin });
    expect(res.status).toBe(200);
    const p = Product.parse(res.body);
    expect(p).toMatchObject({
      gtin, name, brand: "Testbrand", source: "openfoodfacts", caloriesPerServing: 120, servingSize: "30 g",
      allergens: ["milk"], mayContain: ["tree_nuts"], healthScore: "B", smartlabelUrl: null,
      nutrition: { fat_g: 2, sodium_mg: 200 },
      imageUrl: `https://get.test/products/${p.id}.jpg`,
    });
    expect(res.body).not.toHaveProperty("raw");
    expect(putObject).toHaveBeenCalledWith(`products/${p.id}.jpg`, expect.any(Uint8Array), "image/jpeg");

    const item = await prisma.item.findUniqueOrThrow({ where: { id: p.itemId! } });
    expect(item).toMatchObject({ name, category: "pantry" });
    const row = await prisma.product.findUniqueOrThrow({ where: { gtin } });
    expect(row.raw).toMatchObject({ product: { code: gtin } });

    // Second scan: cache hit, no fetch, still one row.
    fetchMock.mockClear();
    const again = await scan({ gtin });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(p.id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.product.count({ where: { gtin } })).toBe(1);
  });

  it("links to an existing catalog item on an exact name match", async () => {
    const gtin = newGtin();
    gtins.push(gtin);
    const name = `Oatloops ${tag()}`;
    const existing = (await request(app).post("/api/items").set(user.auth).send({ name, category: "pantry" })).body;
    routes[offUrl(gtin)] = json(offProduct(gtin, name, { image_front_url: null }));
    const res = await scan({ gtin });
    expect(res.status).toBe(200);
    expect(res.body.itemId).toBe(existing.id);
    expect(res.body.imageUrl).toBeNull();
  });

  it("refetches after 30 days, and serves the stale row if the refetch fails", async () => {
    const gtin = newGtin();
    gtins.push(gtin);
    routes[offUrl(gtin)] = json(offProduct(gtin, `Old ${tag()}`, { image_front_url: null }));
    const first = (await scan({ gtin })).body;
    const old = new Date(Date.now() - CACHE_MS - 60_000);
    await prisma.product.update({ where: { gtin }, data: { fetchedAt: old } });

    const newName = `New ${tag()}`;
    routes[offUrl(gtin)] = json(offProduct(gtin, newName, { image_front_url: null }));
    const refreshed = await scan({ gtin });
    expect(refreshed.body).toMatchObject({ id: first.id, name: newName, itemId: first.itemId });
    expect(new Date(refreshed.body.fetchedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    await prisma.product.update({ where: { gtin }, data: { fetchedAt: old } });
    routes[offUrl(gtin)] = json({}, 503);
    const stale = await scan({ gtin });
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ id: first.id, name: newName });
  });

  it("404s an unknown barcode and 502s an upstream failure", async () => {
    const unknown = newGtin();
    routes[offUrl(unknown)] = json({ status: 0 }, 404);
    expect((await scan({ gtin: unknown })).body.error.code).toBe("PRODUCT_NOT_FOUND");
    const broken = newGtin();
    routes[offUrl(broken)] = json({}, 500);
    const res = await scan({ gtin: broken });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("still returns the product when the image is on a disallowed host, redirects off OFF, or resolves privately", async () => {
    for (const setup of [
      () => ({ image_front_url: "https://evil.example/a.jpg" }),
      () => {
        routes[IMG] = redirect("https://evil.example/a.jpg");
        return {};
      },
      () => {
        routes[IMG] = jpeg;
        dns.address = "169.254.169.254";
        return {};
      },
    ]) {
      const gtin = newGtin();
      gtins.push(gtin);
      routes[offUrl(gtin)] = json(offProduct(gtin, `Imgtest ${tag()}`, setup()));
      const res = await scan({ gtin });
      expect(res.status).toBe(200);
      expect(res.body.imageUrl).toBeNull();
      expect(putObject).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain("https://evil.example/a.jpg");
      dns.address = "93.184.216.34";
    }
  });
});

describe("POST /api/products/scan: SmartLabel QR", () => {
  const fixture = readFileSync(new URL("./fixtures/smartlabel/generic-cereal.html", import.meta.url), "utf8");

  it("parses the label page, saves it with its URL and GTIN, and caches it", async () => {
    const gtin = newGtin();
    const qrUrl = `https://smartlabel.generalmills.smartlabel.org/${randomUUID()}`;
    gtins.push(gtin);
    urls.push(qrUrl);
    const name = `Honey Nutties ${tag()}`;
    routes[qrUrl] = html(fixture.replace(/Honey Nut Cheerios/g, name).replace("UPC: 0 16000-27527 9", `UPC: ${gtin}`));

    const res = await scan({ qrUrl });
    expect(res.status).toBe(200);
    expect(Product.parse(res.body)).toMatchObject({
      name, gtin, smartlabelUrl: qrUrl, source: "smartlabel", caloriesPerServing: 140, imageUrl: null,
    });
    expect(res.body.allergens).toEqual(expect.arrayContaining(["milk", "wheat"]));
    expect(res.body.itemId).toEqual(expect.any(String));
    const row = await prisma.product.findUniqueOrThrow({ where: { smartlabelUrl: qrUrl } });
    expect(row.raw).toMatchObject({ url: qrUrl });

    fetchMock.mockClear();
    expect((await scan({ qrUrl })).body.id).toBe(res.body.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Open Food Facts when the page isn't a label but names a GTIN", async () => {
    const gtin = newGtin();
    const qrUrl = `https://smartlabel.org/${randomUUID()}`;
    gtins.push(gtin);
    urls.push(qrUrl);
    routes[qrUrl] = html(`<html><body><h1>Page moved</h1><p>GTIN: ${gtin}</p></body></html>`);
    routes[offUrl(gtin)] = json(offProduct(gtin, `Fallbackos ${tag()}`, { image_front_url: null }));
    const res = await scan({ qrUrl });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gtin, smartlabelUrl: qrUrl, source: "openfoodfacts" });
    // The barcode scan of the same product is now a cache hit too.
    fetchMock.mockClear();
    expect((await scan({ gtin })).body.id).toBe(res.body.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a host outside the allowlist (SSRF)", async () => {
    const qrUrl = `https://smartlabel.org/${randomUUID()}`;
    routes[qrUrl] = redirect("http://169.254.169.254/latest/meta-data/");
    const res = await scan({ qrUrl });
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("404s a page with neither label data nor a GTIN", async () => {
    const qrUrl = `https://smartlabel.org/${randomUUID()}`;
    routes[qrUrl] = html("<html><body>nothing</body></html>");
    expect((await scan({ qrUrl })).status).toBe(404);
  });
});

describe("POST /api/products/scan: rate limit", () => {
  it("allows 30 requests per minute per user, then 429", async () => {
    const other = await makeUser();
    for (let i = 0; i < 30; i++) expect((await scan({}, other.auth)).status).toBe(400);
    const res = await scan({}, other.auth);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect((await scan({}, user.auth)).status).toBe(400); // per user, not global
  });
});

describe("guessCategory", () => {
  it("maps OFF categories_tags, most specific first", () => {
    expect(guessCategory(["en:plant-based-foods-and-beverages", "en:breakfast-cereals"])).toBe("pantry");
    expect(guessCategory(["en:dairies", "en:cheeses"])).toBe("dairy");
    expect(guessCategory(["en:snacks", "en:frozen-desserts"])).toBe("frozen");
    expect(guessCategory(["en:beverages", "en:sodas"])).toBe("beverages");
    expect(guessCategory([])).toBe("other");
  });
});

describe("fetchProductImage (SSRF guard)", () => {
  const ok = async () => [{ address: "93.184.216.34" }];
  const f = (r: Response) => vi.fn(async () => r) as unknown as typeof fetch;

  it("downloads an OFF jpeg", async () => {
    const res = await fetchProductImage(IMG, { fetch: f(jpeg()), lookup: ok });
    expect(res.contentType).toBe("image/jpeg");
    expect([...res.body]).toEqual([0xff, 0xd8, 0xff]);
  });

  it.each(["http://images.openfoodfacts.org/a.jpg", "https://evil.example/a.jpg", "https://93.184.216.34/a.jpg", "https://u:p@images.openfoodfacts.org/a.jpg", "https://images.openfoodfacts.org:8443/a.jpg", "https://openfoodfacts.org.evil.com/a.jpg"])(
    "refuses %s without fetching",
    async (url) => {
      const fetch = f(jpeg());
      await expect(fetchProductImage(url, { fetch, lookup: ok })).rejects.toMatchObject({ status: 502 });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("refuses private DNS, off-host redirects, non-images and oversized bodies", async () => {
    await expect(fetchProductImage(IMG, { fetch: f(jpeg()), lookup: async () => [{ address: "10.0.0.5" }] })).rejects.toMatchObject({ status: 502 });
    await expect(fetchProductImage(IMG, { fetch: f(redirect("https://evil.example/")()), lookup: ok })).rejects.toMatchObject({ status: 502 });
    await expect(fetchProductImage(IMG, { fetch: f(new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })), lookup: ok })).rejects.toMatchObject({ status: 502 });
    const big = new Response(new Uint8Array(6 * 1024 * 1024), { headers: { "content-type": "image/jpeg" } });
    await expect(fetchProductImage(IMG, { fetch: f(big), lookup: ok })).rejects.toMatchObject({ status: 502 });
  });
});
