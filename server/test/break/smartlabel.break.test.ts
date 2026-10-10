// Break tests (M1): SSRF guard, fetch limits and parser of the standalone SmartLabel client (plan backend/08).
// No internet: DNS is stubbed and a fetch wrapper sends allowlisted URLs to a local HTTP server, so the real Node fetch
// (timeouts, streaming, gzip) is exercised. Tests named "[DEFECT B-xx]" are expected to FAIL.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mapAllergens } from "../../src/modules/products/common.js";
import { allowedSmartLabelUrl, fetchSmartLabelPage, isPrivateAddress, parseSmartLabel } from "../../src/modules/products/smartlabel.js";

const publicDns = async () => [{ address: "93.184.216.34" }];
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/slow") {
      // Headers arrive immediately, then one byte every 100 ms forever.
      res.writeHead(200, { "content-type": "text/html" });
      const t = setInterval(() => res.write("x"), 100);
      res.on("close", () => clearInterval(t));
      return;
    }
    if (path === "/huge") {
      res.writeHead(200, { "content-type": "text/html" }); // chunked, no content-length
      const chunk = Buffer.alloc(64 * 1024, 120);
      let sent = 0;
      const pump = () => { while (sent < 20 * 1024 * 1024 && res.write(chunk)) sent += chunk.length; if (sent < 20 * 1024 * 1024) res.once("drain", () => { sent += chunk.length; pump(); }); else res.end(); };
      res.on("close", () => (sent = Infinity));
      pump();
      return;
    }
    if (path === "/gzip-bomb") {
      const body = gzipSync(Buffer.alloc(50 * 1024 * 1024, 32));
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "content-length": body.length });
      res.end(body);
      return;
    }
    if (path === "/redirect-internal") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>ok</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

// Sends https://smartlabel.org/<path> to the local server; the guard under test still sees the allowlisted URL.
const localFetch = vi.fn(((url: string | URL, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${port}${new URL(String(url)).pathname}`, init)) as typeof fetch);

describe("SSRF: address blocklist", () => {
  it.each(["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "0.0.0.0", "100.100.100.200", "fd12::1"])(
    "blocks %s",
    (a) => expect(isPrivateAddress(a)).toBe(true),
  );

  it.each([
    "::a9fe:a9fe", //          IPv4-compatible ::169.254.169.254 (deprecated, still parsed by stacks)
    "::127.0.0.1", //          IPv4-compatible loopback
    "64:ff9b:1::a9fe:a9fe", // NAT64 local-use prefix (RFC 8215) -> 169.254.169.254 on a NAT64 network
    "2002:a9fe:a9fe::1", //    6to4 embedding 169.254.169.254
    "::ffff:0:a9fe:a9fe", //   SIIT IPv4-translated (RFC 2765)
  ])("[DEFECT B-11] blocks IPv6 forms that embed a private IPv4: %s", (a) => expect(isPrivateAddress(a)).toBe(true));
});

describe("SSRF: URL allowlist tricks", () => {
  it.each([
    "https://smartlabel.org@evil.com/",
    "https://evil.com#.smartlabel.org",
    "https://evil.com?.smartlabel.org",
    "https://evil.com\\.smartlabel.org/",
    "https://evil.com/.smartlabel.org",
    "//evil.com/x",
    "https://smartlabel.org%2eevil.com/",
    "https://localhost/",
    "https://0x7f000001/",
    "https://2130706433/",
    "https://smartlabel.org:443@evil.com/",
    "https://xn--smartlabel-xyz.org/",
    "data:text/html,<h1>x</h1>",
    "file://smartlabel.org/etc/passwd",
  ])("rejects %s", (u) => expect(allowedSmartLabelUrl(u, new URL("https://evil.com/"))?.hostname ?? null).toBeNull());

  it("relative redirect locations stay on the current allowlisted host", () => {
    expect(allowedSmartLabelUrl("https:evil.com", new URL("https://smartlabel.org/a"))?.hostname).toBe("smartlabel.org");
  });
});

describe("SSRF: real fetch through the guard", () => {
  it("an allowlisted host that redirects to the metadata IP is refused before the second fetch", async () => {
    localFetch.mockClear();
    await expect(fetchSmartLabelPage("https://smartlabel.org/redirect-internal", { fetch: localFetch, lookup: publicDns }))
      .rejects.toMatchObject({ status: 502 });
    expect(localFetch).toHaveBeenCalledTimes(1);
  });

  it("a slow-drip body is cut off by the timeout (whole chain, not per read)", async () => {
    const t0 = Date.now();
    await expect(fetchSmartLabelPage("https://smartlabel.org/slow", { fetch: localFetch, lookup: publicDns, timeoutMs: 400 }))
      .rejects.toMatchObject({ status: 502 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("a 20 MB chunked body (no content-length) is rejected at the 2 MB cap", async () => {
    await expect(fetchSmartLabelPage("https://smartlabel.org/huge", { fetch: localFetch, lookup: publicDns }))
      .rejects.toThrow(/too large/i);
  });

  it("a gzip bomb (50 MB inflated) is rejected at the cap on decompressed bytes", async () => {
    await expect(fetchSmartLabelPage("https://smartlabel.org/gzip-bomb", { fetch: localFetch, lookup: publicDns }))
      .rejects.toThrow(/too large/i);
  });

  it("DNS failure and empty DNS answers are refused", async () => {
    await expect(fetchSmartLabelPage("https://smartlabel.org/", { fetch: localFetch, lookup: async () => [] })).rejects.toMatchObject({ status: 502 });
    await expect(fetchSmartLabelPage("https://smartlabel.org/", { fetch: localFetch, lookup: async () => { throw new Error("NXDOMAIN"); } }))
      .rejects.toMatchObject({ status: 502 });
  });
});

describe("parser on hostile / malformed HTML", () => {
  it.each([
    "",
    "<<<>>>",
    "<html><body><h1>Unclosed <p>Ingredients: x",
    `<script type="application/ld+json">{"@graph": 5}</script><h1>X</h1><p>Calories 10</p>`,
    `<script type="application/ld+json">null</script>`,
    `<script type="application/ld+json">{"@type":"Product","name":{"x":1},"brand":{"name":{"y":2}}}</script>`,
    "\u0000".repeat(1000) + "<h1>NUL</h1>",
    "<h1>" + "a".repeat(500_000) + "</h1><p>Calories 10</p>",
  ])("does not throw on malformed input #%#", (html) => {
    expect(() => parseSmartLabel(html)).not.toThrow();
  });

  it("[DEFECT B-13] 25 KB of nested <div>s (well under the 2 MB cap) does not crash the parser", () => {
    // 5,000 unclosed <div>s -> RangeError: Maximum call stack size exceeded inside cheerio text extraction.
    // The error is not an AppError, so once routed it becomes a 500 instead of a 502/"no product".
    expect(() => parseSmartLabel("<h1>X</h1><p>Calories 1</p>" + "<div>".repeat(5_000))).not.toThrow();
  });

  it("[DEFECT B-02] the real 'Contains:' allergen line wins over an earlier 'Contains 2% or less of' ingredient line", () => {
    const { product } = parseSmartLabel(`<h1>Toasted Oats</h1>
      <p>Ingredients: Whole grain oats, sugar.</p>
      <p>Contains 2% or less of: salt, tripotassium phosphate.</p>
      <p>Contains: Milk, Wheat.</p>`);
    expect(product?.allergens).toEqual(["milk", "wheat", "gluten"]); // actual: []
  });

  it("[DEFECT B-02] an allergen statement in the same paragraph as the ingredients is read", () => {
    const { product } = parseSmartLabel(
      `<h1>Crackers</h1><p>Ingredients: Enriched wheat flour, soybean oil, salt. Contains: Wheat, Soy.</p>`,
    );
    expect(product?.allergens).toEqual(["wheat", "soy", "gluten"]); // actual: []
  });

  it("[DEFECT B-06] a page-supplied image URL pointing at internal/non-https targets is not passed on for server-side download (plan 11 step 5)", () => {
    for (const img of ["http://169.254.169.254/latest/meta-data/iam/security-credentials/", "file:///etc/passwd", "http://localhost:5432/"]) {
      const { product } = parseSmartLabel(
        `<html><head><meta property="og:image" content="${img}"></head><body><h1>X</h1><p>Calories 100</p></body></html>`,
      );
      expect(product?.imageUrl ?? null, img).toBeNull();
    }
  });

  it("[DEFECT B-12] JSON-LD values with the wrong type never reach ProductData (servingSize must be string|null, calories >= 0)", () => {
    const ld = { "@type": "Product", name: "X", nutrition: { servingSize: { value: 30, unit: "g" }, calories: "-250" } };
    const { product } = parseSmartLabel(`<script type="application/ld+json">${JSON.stringify(ld)}</script><p>Ingredients: x</p>`);
    expect(typeof product?.servingSize === "string" || product?.servingSize === null).toBe(true);
    expect(product?.caloriesPerServing === null || product!.caloriesPerServing >= 0).toBe(true);
  });
});

describe("allergen keyword table (08) consistency with the AI table (10)", () => {
  it("[DEFECT B-03] common compound words in 'Contains:' text map to the allergen", () => {
    expect(mapAllergens("Contains: buttermilk")).toContain("milk");
    expect(mapAllergens("Contains: crabmeat")).toContain("shellfish");
  });
});
