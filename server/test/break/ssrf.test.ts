/**
 * Attack 7: SSRF and scraping (backend/08). Every outbound request goes through the stubbed `http.fetch`; requests to
 * allowlisted SmartLabel hosts are answered by a LOCAL 127.0.0.1 server (DNS-free), never by the real internet. Real
 * internal infrastructure is never contacted: "disallowed" targets are only checked to be refused BEFORE any fetch.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "../../src/lib/http.js";
import { isSmartLabelHost } from "../../src/lib/smartlabel.js";
import { productHooks } from "../../src/modules/products/service.js";
import { api, expectErrorShape, guardNetwork, makeUser, realFetch, tag, type TestUser } from "./helpers.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_q, s) => s.end("no handler");
let server: Server;
let origin: string;
let fetched: string[] = [];
let user: TestUser;

beforeAll(async () => {
  server = createServer((q, s) => handler(q, s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
beforeEach(async () => {
  guardNetwork();
  fetched = [];
  vi.spyOn(productHooks, "afterSave").mockResolvedValue(undefined);
  // Allowlisted SmartLabel hosts → the local server; anything else must never be fetched.
  vi.spyOn(http, "fetch").mockImplementation(async (url: string, init?: RequestInit) => {
    fetched.push(url);
    const u = new URL(url);
    if (u.protocol === "https:" && isSmartLabelHost(u.hostname)) return realFetch(`${origin}${u.pathname}${u.search}`, init);
    if (u.hostname === "world.openfoodfacts.org") return realFetch(`${origin}/off${u.pathname}`, init);
    throw new Error(`SSRF: tried to fetch ${url}`);
  });
  user = await makeUser(); // fresh user per test: the scan limit is 30/min per user
});
afterEach(() => vi.restoreAllMocks());

const scan = (body: object, who = user) => api().post("/api/products/scan").set(who.auth).send(body);
const htmlPage = (body: string, status = 200): Handler => (_q, s) => {
  s.writeHead(status, { "content-type": "text/html" });
  s.end(body);
};
const jsonLd = (product: Record<string, unknown>) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", ...product })}</script></head><body><p>Contains: wheat.</p></body></html>`;

describe("attack 7: the QR link itself", () => {
  it("non-SmartLabel targets are refused with 400 HOST_NOT_ALLOWED before any fetch", async () => {
    const urls = [
      "http://localhost/", "https://localhost:3000/api/health", "http://127.0.0.1/", "https://127.0.0.1/", "http://[::1]/",
      "https://169.254.169.254/latest/meta-data/", "http://169.254.169.254/", "https://10.0.0.1/", "https://192.168.1.1/",
      "https://172.16.0.1/", "https://0.0.0.0/", "https://2130706433/", "https://0x7f000001/", "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_PING", "ftp://smartlabel.org/x", "data:text/html,<h1>x</h1>", "javascript:alert(1)",
      "https://smartlabel.org@169.254.169.254/", "https://169.254.169.254#@smartlabel.org", "https://169.254.169.254?.smartlabel.org",
      "https://smartlabel.org.evil.example/", "https://evilsmartlabel.org/", "https://smartlabel.org:8443/x",
      "https://user:pw@smartlabel.org/x", "https://smartlabel.org%2f@127.0.0.1/", "//169.254.169.254/", "smartlabel.org/x",
      "https://xn--smartlabel-xyz.org/", "https://smartlabel。org.evil.example/",
    ];
    const failures: string[] = [];
    for (const qrUrl of urls) {
      const res = await scan({ qrUrl });
      if (res.status !== 400 || res.body?.error?.code !== "HOST_NOT_ALLOWED") failures.push(`${qrUrl} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    expect(failures).toEqual([]);
    expect(fetched).toEqual([]);
  });
});

describe("attack 7: redirects", () => {
  it("an allowlisted page that redirects to a disallowed target is refused, and the target is never fetched", async () => {
    const targets = [
      `${origin}/internal`, "http://169.254.169.254/latest/meta-data/", "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/admin", "https://localhost/", "http://smartlabel.org/downgrade", "https://smartlabel.org:8443/port",
      "https://user:pw@smartlabel.org/creds", "file:///etc/passwd", "//127.0.0.1/proto-relative", "https://evil.example/x",
    ];
    const failures: string[] = [];
    for (const to of targets) {
      handler = (_q, s) => {
        s.writeHead(302, { location: to });
        s.end();
      };
      fetched = [];
      const res = await scan({ qrUrl: `https://smartlabel.org/r/${tag()}` });
      const outside = fetched.filter((f) => !isSmartLabelHost(new URL(f).hostname) || !f.startsWith("https://smartlabel.org/"));
      if (res.status !== 400 || res.body?.error?.code !== "HOST_NOT_ALLOWED" || outside.length) {
        failures.push(`${to} → ${res.status} ${JSON.stringify(res.body)} fetched=${JSON.stringify(fetched)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("a redirect loop ends with a clean 502, not a hang or 500", async () => {
    handler = (q, s) => {
      s.writeHead(302, { location: `/loop/${Number(q.url?.split("/").pop() ?? 0) + 1}` });
      s.end();
    };
    const res = await scan({ qrUrl: "https://smartlabel.org/loop/0" });
    expectErrorShape(res, 502);
    expect(fetched.length).toBeLessThanOrEqual(6);
  });
});
