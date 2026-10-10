// Break tests (M3/M4): POST /api/products/scan end to end (plan backend/08, 11 step 5). Real app + local Postgres.
// No network: DNS, S3 and global fetch are stubbed; unrouted fetches throw. Tests named "[DEFECT M3-xx]" are expected
// to FAIL until the defect is fixed.
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../../src/app.js";
import { Group } from "../../../src/contracts/groups.js";
import { prisma } from "../../../src/db.js";
import { putObject } from "../../../src/lib/s3.js";
import { CACHE_MS } from "../../../src/modules/products/service.js";
import { parseSmartLabel } from "../../../src/modules/products/smartlabel.js";
import { cleanupUsers, makeUser } from "../../helpers.js";

const dns = vi.hoisted(() => ({ address: "93.184.216.34" as string, fail: false }));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => {
    if (dns.fail) throw new Error("ENOTFOUND");
    return [{ address: dns.address }];
  }),
}));
vi.mock("../../../src/lib/s3.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/lib/s3.js")>()),
  putObject: vi.fn(async () => {}),
  presignGet: vi.fn(async (key: string) => `https://get.test/${key}`),
}));

type Route = (init?: RequestInit) => Response;
let routes: Record<string, Route> = {};
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const route = routes[url] ?? routes[url.split("?")[0]];
  if (!route) throw new Error(`unexpected fetch ${url}`);
  return route(init);
});
vi.stubGlobal("fetch", fetchMock);

const offUrl = (gtin: string) => `https://world.openfoodfacts.org/api/v2/product/${gtin}.json`;
const json = (body: unknown, status = 200): Route => () => new Response(JSON.stringify(body), { status });
const html = (body: string): Route => () => new Response(body, { headers: { "content-type": "text/html" } });
const redirect = (location: string): Route => () => new Response(null, { status: 302, headers: { location } });
const tag = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 8);
const newGtin = (len = 13) => `9${String(randomInt(10 ** (len - 1))).padStart(len - 1, "0")}`;
const IMG = "https://images.openfoodfacts.org/images/products/x/front.jpg";

const offProduct = (gtin: string, name: string, extra: object = {}) => ({
  status: 1,
  product: {
    code: gtin, product_name: name, brands: "Testbrand", nutriments: { "energy-kcal_serving": 120 }, serving_size: "30 g",
    ingredients_text: "Peanuts, salt", allergens_tags: ["en:peanuts"], traces_tags: [], image_front_url: null,
    categories_tags: [], ...extra,
  },
});
const labelPage = (name: string, gtin?: string, body = "<p>Calories 100</p><p>Ingredients: Sugar.</p>") =>
  `<html><head>${gtin ? `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name, gtin13: gtin })}</script>` : ""}` +
  `</head><body><h1>${name}</h1>${body}</body></html>`;

// Rotate users so the 30/min/user scan limiter only bites in the rate-limit test.
let user: Awaited<ReturnType<typeof makeUser>> | undefined;
let uses = 0;
async function scan(body: unknown) {
  if (!user || ++uses % 20 === 0) user = await makeUser();
  return request(app).post("/api/products/scan").set(user.auth).send(body as object);
}
const gtins: string[] = [];
const urls: string[] = [];
const slUrl = () => {
  const u = `https://smartlabel.org/p/${tag()}`;
  urls.push(u);
  return u;
};

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  vi.mocked(putObject).mockClear();
  dns.address = "93.184.216.34";
  dns.fail = false;
});
afterAll(async () => {
  const items = (await prisma.product.findMany({ where: { OR: [{ gtin: { in: gtins } }, { smartlabelUrl: { in: urls } }] }, select: { itemId: true } }))
    .flatMap((p) => (p.itemId ? [p.itemId] : []));
  await prisma.product.deleteMany({ where: { OR: [{ gtin: { in: gtins } }, { smartlabelUrl: { in: urls } }] } });
  await cleanupUsers();
  await prisma.item.deleteMany({ where: { id: { in: items }, cabinetItems: { none: {} }, listItems: { none: {} }, preferences: { none: {} } } }).catch(() => {});
});

const expectErrorShape = (res: request.Response, status: number, code?: string) => {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(["error"]);
  expect(Object.keys(res.body.error).sort()).toEqual(["code", "message"]);
  if (code) expect(res.body.error.code).toBe(code);
  expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
};

describe("SSRF via qrUrl (rejected before any fetch)", () => {
  it.each([
    "https://localhost/x", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://10.0.0.1/",
    "https://[::1]/", "https://[::ffff:a9fe:a9fe]/", "file:///etc/passwd", "http://smartlabel.org/x",
    "https://smartlabel.org:8443/x", "https://user:pw@smartlabel.org/x", "https://smartlabel.org.evil.com/",
    "https://evil.com/#.smartlabel.org", "https://evilsmartlabel.org/", "gopher://smartlabel.org/", "//smartlabel.org/x",
    "https://2852039166/", "https://0xa9fea9fe/", "javascript:alert(1)", "data:text/html,<h1>x</h1>",
  ])("%s -> 400, no fetch", async (qrUrl) => {
    const res = await scan({ qrUrl });
    expectErrorShape(res, 400, "VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allowed host that resolves to a private IP -> 502, no fetch", async () => {
    for (const addr of ["127.0.0.1", "169.254.169.254", "10.1.2.3", "192.168.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      dns.address = addr;
      const res = await scan({ qrUrl: slUrl() });
      expectErrorShape(res, 502, "UPSTREAM_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unresolvable host -> 502", async () => {
    dns.fail = true;
    expectErrorShape(await scan({ qrUrl: slUrl() }), 502, "UPSTREAM_ERROR");
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/", "https://169.254.169.254/", "https://evil.example/", "file:///etc/passwd",
    "http://smartlabel.org/insecure", "https://smartlabel.org:444/", "//evil.example/x",
  ])("allowed host redirecting to %s -> 502, second hop never fetched", async (location) => {
    const url = slUrl();
    routes[url] = redirect(location);
    const res = await scan({ qrUrl: url });
    expectErrorShape(res, 502, "UPSTREAM_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirect loop stops (too many redirects -> 502)", async () => {
    const url = slUrl();
    routes[url] = redirect(url);
    expectErrorShape(await scan({ qrUrl: url }), 502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("slow body is cut off by the 5 s timeout -> 502", async () => {
    const url = slUrl();
    routes[url] = (init) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("<h1>slow"));
            init?.signal?.addEventListener("abort", () => c.error(init.signal!.reason));
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    const t0 = Date.now();
    expectErrorShape(await scan({ qrUrl: url }), 502, "UPSTREAM_ERROR");
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 15000);

  it("huge chunked body (no content-length) is capped -> 502", async () => {
    const url = slUrl();
    let sent = 0;
    routes[url] = () =>
      new Response(
        new ReadableStream({
          pull(c) {
            if (sent > 20 * 1024 * 1024) return c.close();
            sent += 65536;
            c.enqueue(new Uint8Array(65536).fill(120));
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    expectErrorShape(await scan({ qrUrl: url }), 502, "UPSTREAM_ERROR");
    expect(sent).toBeLessThan(4 * 1024 * 1024);
  }, 20000);

  it.each(["", "<<<>>>", "\u0000\u0001garbage", "<html><body>" + "<div>".repeat(20000), "<script>while(1){}</script>", "%PDF-1.4 binary"])(
    "malformed page %# -> 404 PRODUCT_NOT_FOUND, never 500",
    async (body) => {
      const url = slUrl();
      routes[url] = html(body);
      expectErrorShape(await scan({ qrUrl: url }), 404, "PRODUCT_NOT_FOUND");
    },
    20000, // the 20k-nested-div page takes seconds of CPU under a loaded full run
  );
});

describe("parser CPU budget", () => {
  it("[DEFECT M3-19] 120 KB of nested <div>s blocks the event loop for seconds (super-linear; 2 MB cap allows far worse)", () => {
    const t0 = performance.now();
    parseSmartLabel("<html><body>" + "<div>".repeat(20000));
    expect(performance.now() - t0).toBeLessThan(1000); // measured ~5 s; 40k divs (240 KB) ~21 s
  }, 60000);
});

describe("validation and response shape", () => {
  it.each([
    [{ gtin: 12345678 }], [{ gtin: "1234567" }], [{ gtin: "123456789012345" }], [{ gtin: "１２３４５６７８" }],
    [{ gtin: "1234 5678" }], [{ gtin: "-12345678" }], [{ gtin: null }], [{ qrUrl: null }], [{ qrUrl: 5 }],
    [{ qrUrl: "https://smartlabel.org/" + "a".repeat(2100) }], [{ qrUrl: "https://smartlabel.org/\u0000x" }],
    [[]], [{ gtin: ["12345678"] }], [{ gtin: "' OR 1=1 --" }],
  ])("%j -> 400 standard shape, no fetch", async (body) => {
    expectErrorShape(await scan(body), 400, "VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("malformed JSON -> 400 standard shape", async () => {
    const u = await makeUser();
    const res = await request(app).post("/api/products/scan").set(u.auth).set("content-type", "application/json").send('{"gtin":');
    expectErrorShape(res, 400, "VALIDATION_ERROR");
  });

  it("__proto__ / constructor keys in the JSON body -> 400 (strict schema)", async () => {
    const u = await makeUser();
    for (const raw of ['{"gtin":"12345678","__proto__":{"admin":true}}', '{"gtin":"12345678","constructor":{"prototype":{"x":1}}}']) {
      const res = await request(app).post("/api/products/scan").set(u.auth).set("content-type", "application/json").send(raw);
      expectErrorShape(res, 400, "VALIDATION_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raw upstream payload and the S3 key are never returned", async () => {
    const gtin = newGtin();
    gtins.push(gtin);
    routes[offUrl(gtin)] = json(offProduct(gtin, `Rawcheck ${tag()}`, { image_front_url: IMG }));
    routes[IMG] = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
    const res = await scan({ gtin });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("raw");
    expect(res.body).not.toHaveProperty("imageS3Key");
    expect(JSON.stringify(res.body)).not.toContain('"status":1');
  });
});

describe("product image copy (11 step 5)", () => {
  it.each([
    ["text/html body labelled html", () => new Response("<script>x</script>", { headers: { "content-type": "text/html" } })],
    ["svg (script-capable)", () => new Response("<svg onload=alert(1)>", { headers: { "content-type": "image/svg+xml" } })],
    ["declared 50 MB", () => new Response("x", { headers: { "content-type": "image/jpeg", "content-length": String(50 * 1024 * 1024) } })],
    ["redirect to metadata", redirect("http://169.254.169.254/latest/meta-data/")],
    ["redirect off OFF", redirect("https://evil.example/a.jpg")],
  ] as [string, Route][])("%s: not copied, scan still 200", async (_n, route) => {
    const gtin = newGtin();
    gtins.push(gtin);
    routes[offUrl(gtin)] = json(offProduct(gtin, `Img ${tag()}`, { image_front_url: IMG }));
    routes[IMG] = route;
    const res = await scan({ gtin });
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("streamed image over 5 MB (no content-length) is not copied", async () => {
    const gtin = newGtin();
    gtins.push(gtin);
    routes[offUrl(gtin)] = json(offProduct(gtin, `BigImg ${tag()}`, { image_front_url: IMG }));
    let sent = 0;
    routes[IMG] = () =>
      new Response(new ReadableStream({ pull(c) { if (sent > 8e6) return c.close(); sent += 65536; c.enqueue(new Uint8Array(65536)); } }), {
        headers: { "content-type": "image/jpeg" },
      });
    const res = await scan({ gtin });
    expect(res.status).toBe(200);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("SmartLabel og:image on a non-OFF host / IP literal is never fetched", async () => {
    for (const img of ["https://evil.example/a.jpg", "http://169.254.169.254/a.jpg", "file:///etc/passwd", "https://[::1]/a.jpg"]) {
      const url = slUrl();
      routes[url] = html(`<html><head><meta property="og:image" content="${img}"></head><body><h1>Og ${tag()}</h1><p>Calories 90</p></body></html>`);
      fetchMock.mockClear();
      const res = await scan({ qrUrl: url });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1); // the page only
    }
  });
});

describe("rate limit: 30 scans/min/user (GAPS #22)", () => {
  it("31st request in a minute is 429 RATE_LIMITED (std shape); another user is unaffected", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await request(app).post("/api/products/scan").set(a.auth).send({ gtin: "1" })).status);
    expect(codes.slice(0, 30).every((c) => c === 400)).toBe(true);
    const res = await request(app).post("/api/products/scan").set(a.auth).send({ gtin: "1" });
    expectErrorShape(res, 429, "RATE_LIMITED");
    expect((await request(app).post("/api/products/scan").set(b.auth).send({ gtin: "1" })).status).toBe(400);
  });

  it("the limit can't be dodged with spoofed X-Forwarded-For (keyed by user)", async () => {
    const a = await makeUser();
    for (let i = 0; i < 30; i++) await request(app).post("/api/products/scan").set(a.auth).send({ gtin: "1" });
    const res = await request(app).post("/api/products/scan").set(a.auth).set("X-Forwarded-For", "1.2.3.4").send({ gtin: "1" });
    expect(res.status).toBe(429);
  });
});

describe("concurrency", () => {
  it("[DEFECT M3-05] 5 simultaneous first scans of one new barcode: all 200 (actual: some 409 CONFLICT from the catalog-item upsert race)", async () => {
    const statuses: number[] = [];
    for (let round = 0; round < 4; round++) {
      const gtin = newGtin();
      gtins.push(gtin);
      routes[offUrl(gtin)] = json(offProduct(gtin, `Race ${tag()}`));
      const u = await makeUser();
      const res = await Promise.all(Array.from({ length: 5 }, () => request(app).post("/api/products/scan").set(u.auth).send({ gtin })));
      statuses.push(...res.map((r) => r.status));
      expect(new Set(res.filter((r) => r.status === 200).map((r) => r.body.id)).size).toBe(1);
    }
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  });
});

describe("cache integrity (products are global, GAPS #10)", () => {
  it("[DEFECT M3-01] a SmartLabel scan whose page names barcode G overwrites G's fresh cached row and erases its allergens", async () => {
    const gtin = newGtin();
    gtins.push(gtin);
    routes[offUrl(gtin)] = json(offProduct(gtin, `Peanut Crunch ${tag()}`));
    const first = await scan({ gtin });
    expect(first.body.allergens).toEqual(["peanuts"]);

    // Any user scans a label page (heuristic parse finds no "Contains:" line) that names the same GTIN.
    const url = slUrl();
    routes[url] = html(labelPage(`Peanut Crunch ${tag()}`, gtin));
    expect((await scan({ qrUrl: url })).status).toBe(200);

    // Another household scans the barcode within the 30-day window: plan step 2 says "return the cached row".
    fetchMock.mockClear();
    const again = await scan({ gtin });
    expect(again.body.allergens).toContain("peanuts");
  });

  it("[DEFECT M3-02] refreshing a QR whose page now shows a GTIN deletes the old product row; every household's cabinet loses its product link", async () => {
    const url = slUrl();
    const name = `Granola ${tag()}`;
    routes[url] = html(labelPage(name)); // no GTIN on the page yet
    const p1 = (await scan({ qrUrl: url })).body;
    expect(p1.gtin).toBeNull();

    const owner = await makeUser();
    const g = Group.parse((await request(app).post("/api/groups").set(owner.auth).send({ name: "Cab" }).expect(201)).body);
    const cab = await prisma.cabinetItem.create({ data: { groupId: g.id, itemId: p1.itemId, productId: p1.id, addedBy: owner.id } });

    await prisma.product.update({ where: { id: p1.id }, data: { fetchedAt: new Date(Date.now() - CACHE_MS - 60_000) } });
    const gtin = newGtin();
    gtins.push(gtin);
    routes[url] = html(labelPage(name, gtin));
    const p2 = (await scan({ qrUrl: url })).body;
    expect(p2.gtin).toBe(gtin);

    const after = await prisma.cabinetItem.findUniqueOrThrow({ where: { id: cab.id } });
    expect(after.productId).not.toBeNull();
  });

  it("[DEFECT M3-03] a 12-digit UPC that Open Food Facts returns as a 13-digit code is never served from the cache", async () => {
    const upc = newGtin(12);
    gtins.push(upc, `0${upc}`);
    routes[offUrl(upc)] = json(offProduct(`0${upc}`, `Upc ${tag()}`)); // OFF reports US UPC-A codes as EAN-13
    expect((await scan({ gtin: upc })).status).toBe(200);
    fetchMock.mockClear();
    expect((await scan({ gtin: upc })).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled(); // "Scanning it a second time is served from the cache" (08 Done when)
  });

  it("[DEFECT M3-04] a NUL byte in crowd-sourced Open Food Facts data turns the scan into 500 INTERNAL", async () => {
    for (const extra of [{ product_name: `Nul\u0000Bar ${tag()}` }, { brands: "Acme\u0000" }, { ingredients_text: "Oats\u0000" }]) {
      const gtin = newGtin();
      gtins.push(gtin);
      routes[offUrl(gtin)] = json(offProduct(gtin, `Nulcheck ${tag()}`, extra));
      const res = await scan({ gtin });
      expect(res.status).not.toBe(500);
    }
  });
});
