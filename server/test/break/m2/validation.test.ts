import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, api, cleanup, isErrorShape, makeUser, mkGroup, mkItem, prisma, trackItem, type U } from "./helpers.js";

// Attack #6: input validation on every M2 route. Every rejection must be 4xx in {error:{code,message}} with no internals.
afterAll(cleanup);

let o: U, m: U, g: { id: string }, item: { id: string }, pref: string, cab: string, row: string, inv: string;

beforeAll(async () => {
  [o, m] = [await makeUser(), await makeUser()];
  g = await mkGroup(o, "Valid");
  await addMember(g.id, m);
  item = await mkItem("ValItem");
  pref = (await api().post(`/api/groups/${g.id}/preferences`).set(o.auth).send({ itemId: item.id }).expect(200)).body.id;
  cab = (await api().post(`/api/groups/${g.id}/cabinet`).set(o.auth).send({ itemId: item.id }).expect(200)).body.id;
  row = (await api().post(`/api/groups/${g.id}/shopping-list`).set(o.auth).send({ itemId: item.id }).expect(200)).body.id;
  inv = (await api().post(`/api/groups/${g.id}/invites`).set(o.auth).send({ email: `v-${randomUUID()}@example.com` }).expect(201)).body.id;
});

const leaksInternals = (body: unknown) => /prisma|invalid input syntax|\bat .*\.(ts|js):\d+|node_modules|stack|SELECT|INSERT|UPDATE /i.test(JSON.stringify(body));

async function expectRejected(r: { status: number; body: unknown }, label: string) {
  expect.soft(r.status, `${label} -> ${JSON.stringify(r.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
  expect.soft(r.status, `${label} must not be 5xx`).toBeLessThan(500);
  expect.soft(isErrorShape(r.body), `${label} shape`).toBe(true);
  expect.soft(leaksInternals(r.body), `${label} leaks internals`).toBe(false);
}

type Case = [label: string, method: "post" | "patch" | "put", path: () => string, body: unknown];
const big = "x".repeat(10_000);
const BAD_VALUES: [string, unknown][] = [
  ["number", 42], ["negative", -1], ["bool", true], ["object", { $ne: null }], ["array", ["a"]], ["huge", big], ["empty", ""],
  ["whitespace", "   "],
];

describe("wrong types, missing/extra fields, huge values", () => {
  it("rejects each bad field value on every M2 write route", async () => {
    const routes: [string, "post" | "patch" | "put", () => string, (v: unknown) => object][] = [
      ["group name", "post", () => "/api/groups", (v) => ({ name: v })],
      ["rename", "patch", () => `/api/groups/${g.id}`, (v) => ({ name: v })],
      ["invite email", "post", () => `/api/groups/${g.id}/invites`, (v) => ({ email: v })],
      ["item name", "post", () => "/api/items", (v) => ({ name: v })],
      ["item category", "post", () => "/api/items", (v) => ({ name: "Valid Name", category: v })],
      ["item aliasOf", "post", () => "/api/items", (v) => ({ name: "Valid Name", aliasOf: v })],
      ["pref itemId", "post", () => `/api/groups/${g.id}/preferences`, (v) => ({ itemId: v })],
      ["pref quantity", "post", () => `/api/groups/${g.id}/preferences`, (v) => ({ itemId: item.id, quantityText: v })],
      ["pref recurrence", "patch", () => `/api/groups/${g.id}/preferences/${pref}`, (v) => ({ recurrence: v })],
      ["pref note", "patch", () => `/api/groups/${g.id}/preferences/${pref}`, (v) => ({ note: v })],
      ["cab itemId", "post", () => `/api/groups/${g.id}/cabinet`, (v) => ({ itemId: v })],
      ["cab location", "post", () => `/api/groups/${g.id}/cabinet`, (v) => ({ itemId: item.id, location: v })],
      ["cab expiresAt", "patch", () => `/api/groups/${g.id}/cabinet/${cab}`, (v) => ({ expiresAt: v })],
      ["cab status", "patch", () => `/api/groups/${g.id}/cabinet/${cab}`, (v) => ({ status: v })],
      ["cab photoKey", "patch", () => `/api/groups/${g.id}/cabinet/${cab}`, (v) => ({ photoKey: v })],
      ["list itemId", "post", () => `/api/groups/${g.id}/shopping-list`, (v) => ({ itemId: v })],
      ["list checked", "patch", () => `/api/groups/${g.id}/shopping-list/${row}`, (v) => ({ checked: v })],
      ["list scannedProductId", "patch", () => `/api/groups/${g.id}/shopping-list/${row}`, (v) => ({ checked: true, scannedProductId: v })],
      ["dietary allergens", "put", () => "/api/me/dietary", (v) => ({ diets: [], allergens: v })],
      ["dietary diets", "put", () => "/api/me/dietary", (v) => ({ diets: v, allergens: [] })],
    ];
    for (const [label, method, path, mk] of routes) {
      for (const [vn, v] of BAD_VALUES) {
        // Some values are legitimately valid for some fields (e.g. "huge" is fine nowhere, "array" fine for dietary).
        if (label.startsWith("dietary") && vn === "array") continue;
        if (label === "list checked" && vn === "bool") continue;
        if (label === "cab photoKey" && vn === "empty") continue; // rejected by regex anyway, checked below
        await expectRejected(await api()[method](path()).set(o.auth).send(mk(v)), `${label}=${vn}`);
      }
    }
  });

  it("rejects extra fields, missing fields, non-object bodies, arrays, and a >1 MB body", async () => {
    const cases: Case[] = [
      ["extra field on pref", "post", () => `/api/groups/${g.id}/preferences`, { itemId: item.id, userId: m.id }],
      ["extra groupId on cabinet", "post", () => `/api/groups/${g.id}/cabinet`, { itemId: item.id, groupId: randomUUID() }],
      ["extra status on list add", "post", () => `/api/groups/${g.id}/shopping-list`, { itemId: item.id, checked: true }],
      ["checkedBy spoof", "patch", () => `/api/groups/${g.id}/shopping-list/${row}`, { checked: true, checkedBy: m.id }],
      ["role on invite", "post", () => `/api/groups/${g.id}/invites`, { email: "a@b.co", role: "owner" }],
      ["__proto__ pollution", "post", () => `/api/groups/${g.id}/preferences`, JSON.parse(`{"itemId":"${item.id}","__proto__":{"admin":true}}`)],
      ["missing itemId", "post", () => `/api/groups/${g.id}/cabinet`, {}],
      ["missing checked", "patch", () => `/api/groups/${g.id}/shopping-list/${row}`, {}],
      ["array body", "post", () => `/api/groups/${g.id}/preferences`, [{ itemId: item.id }]],
      ["dietary 21 values", "put", () => "/api/me/dietary", { diets: [], allergens: Array(21).fill("milk") }],
      ["dietary 100k array", "put", () => "/api/me/dietary", { diets: [], allergens: Array(100_000).fill("milk") }],
      ["body over 1MB", "post", () => "/api/groups", { name: "x".repeat(1_100_000) }],
    ];
    for (const [label, method, path, body] of cases) await expectRejected(await api()[method](path()).set(o.auth).send(body as object), label);
    const raw = await api().post(`/api/groups/${g.id}/preferences`).set(o.auth).set("Content-Type", "application/json").send("{bad json");
    await expectRejected(raw, "malformed JSON");
    expect(Object.getPrototypeOf({}).admin).toBeUndefined();
  });

  it("invalid UUIDs in paths are 4xx (not 500) on every :id route", async () => {
    const bad = ["not-a-uuid", "1", "00000000-0000-0000-0000-00000000000g", "' OR 1=1 --", "%00", encodeURIComponent("../../etc/passwd"), "a".repeat(5000)];
    for (const b of bad) {
      for (const [m_, p] of [
        ["get", `/api/groups/${b}`],
        ["get", `/api/groups/${b}/shopping-list`],
        ["patch", `/api/groups/${g.id}/preferences/${b}`],
        ["delete", `/api/groups/${g.id}/preferences/${b}`],
        ["patch", `/api/groups/${g.id}/cabinet/${b}`],
        ["post", `/api/groups/${g.id}/cabinet/${b}/ran-out`],
        ["delete", `/api/groups/${g.id}/cabinet/${b}`],
        ["patch", `/api/groups/${g.id}/shopping-list/${b}`],
        ["delete", `/api/groups/${g.id}/shopping-list/${b}`],
        ["delete", `/api/groups/${g.id}/invites/${b}`],
        ["delete", `/api/groups/${g.id}/members/${b}`],
        ["post", `/api/invites/${b}/accept`],
        ["post", `/api/invites/${b}/decline`],
      ] as const) {
        const r = await (api() as any)[m_](p).set(o.auth).send(m_ === "patch" ? { checked: true, note: "n" } : undefined);
        await expectRejected(r, `${m_} ${p.slice(0, 80)}`);
      }
    }
  });

  it("valid-looking but unknown UUIDs are 404 in the standard shape", async () => {
    const u = randomUUID();
    for (const p of [`/api/groups/${g.id}/preferences/${u}`, `/api/groups/${g.id}/cabinet/${u}`, `/api/groups/${g.id}/shopping-list/${u}`]) {
      const r = await api().delete(p).set(o.auth);
      expect(r.status).toBe(404);
      expect(isErrorShape(r.body)).toBe(true);
    }
    await expectRejected(await api().post(`/api/groups/${g.id}/preferences`).set(o.auth).send({ itemId: u }), "unknown itemId");
    await expectRejected(await api().post(`/api/groups/${g.id}/cabinet`).set(o.auth).send({ itemId: u }), "unknown cab itemId");
    await expectRejected(await api().post(`/api/groups/${g.id}/shopping-list`).set(o.auth).send({ itemId: u }), "unknown list itemId");
  });

  it("query strings: repeated keys, arrays and unknown enum values are 400", async () => {
    for (const q of ["userId=me&userId=all", "userId=someone", "userId=ALL"]) {
      await expectRejected(await api().get(`/api/groups/${g.id}/preferences?${q}`).set(o.auth), `prefs ?${q}`);
    }
    for (const q of ["status=gone", "location=garage", "status=in_stock&status=running_low"]) {
      await expectRejected(await api().get(`/api/groups/${g.id}/cabinet?${q}`).set(o.auth), `cabinet ?${q}`);
    }
    await expectRejected(await api().get(`/api/groups/${g.id}/invites?status=revoked`).set(o.auth), "invites ?status=revoked");
    // Express 5's simple parser keeps "userId[]" as a different key, so these fall back to the default "me": harmless.
    await api().post(`/api/groups/${g.id}/preferences`).set(m.auth).send({ itemId: item.id }).expect(200);
    for (const q of ["userId[]=all", "userId[$ne]=me"]) {
      const r = await api().get(`/api/groups/${g.id}/preferences?${q}`).set(o.auth).expect(200);
      expect(r.body.every((p: { userId: string }) => p.userId === o.id)).toBe(true);
    }
  });
});

describe("/items/search", () => {
  it("SQL-looking, wildcard, unicode and edge inputs never 500 and never return the whole catalog", async () => {
    const qs = [
      "' OR '1'='1", "'; DROP TABLE items; --", "%", "%%", "_", "\\", "milk') UNION SELECT * FROM users --", "1; SELECT pg_sleep(5)",
      "😀😀😀", "İİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİİ",
      "ǅ".repeat(100), "a\u0000b", "‮milk", "ﬃ".repeat(100), "x".repeat(101), "",
    ];
    for (const q of qs) {
      const t = Date.now();
      const r = await api().get("/api/items/search").query({ q }).set(o.auth);
      expect.soft(Date.now() - t, q).toBeLessThan(3000);
      if (r.status === 200) {
        expect.soft(r.body.results.length, q).toBeLessThanOrEqual(5);
        expect.soft(["exact", "suggested", "none"]).toContain(r.body.match);
      } else await expectRejected(r, `search ${JSON.stringify(q).slice(0, 40)}`);
    }
    await expectRejected(await api().get("/api/items/search").set(o.auth), "missing q");
    await expectRejected(await api().get("/api/items/search?q=a&q=b").set(o.auth), "repeated q");
    expect(await prisma.item.count()).toBeGreaterThan(0); // still there
  });
});

describe("null bytes and unicode in stored text", () => {
  it("[DEFECT M2-01] a NUL byte in any stored string is a 4xx, not 500 INTERNAL", async () => {
    const nul = "bad\u0000value";
    const cases: Case[] = [
      ["group name", "post", () => "/api/groups", { name: nul }],
      ["rename group", "patch", () => `/api/groups/${g.id}`, { name: nul }],
      ["item name", "post", () => "/api/items", { name: `Nul ${nul}` }],
      ["pref quantityText", "post", () => `/api/groups/${g.id}/preferences`, { itemId: item.id, quantityText: nul }],
      ["pref note", "patch", () => `/api/groups/${g.id}/preferences/${pref}`, { note: nul }],
      ["cabinet quantityText", "patch", () => `/api/groups/${g.id}/cabinet/${cab}`, { quantityText: nul }],
      ["list quantityText", "post", () => `/api/groups/${g.id}/shopping-list`, { itemId: item.id, quantityText: nul }],
    ];
    const got: string[] = [];
    for (const [label, method, path, body] of cases) {
      const r = await api()[method](path()).set(o.auth).send(body as object);
      if (r.status >= 500) got.push(`${label}: ${r.status} ${r.body?.error?.code}`);
      if (r.status === 200 && label === "item name") trackItem(r.body.id);
    }
    expect(got).toEqual([]);
  });

  it("unicode, RTL overrides and emoji round-trip unchanged where accepted", async () => {
    const s = "Ñandú 🍎 ‮gnirts";
    const r = await api().patch(`/api/groups/${g.id}/preferences/${pref}`).set(o.auth).send({ note: s }).expect(200);
    expect(r.body.note).toBe(s);
    const n = await api().post("/api/groups").set(o.auth).send({ name: "家 🏠" }).expect(201);
    expect(n.body.name).toBe("家 🏠");
  });

  it("negative / out-of-range dates are rejected; a far-future but valid date is accepted", async () => {
    for (const d of ["-0001-01-01", "2026-02-30", "2026-13-01", "20261010", "2026-10-10T00:00:00Z", "0000-00-00"]) {
      await expectRejected(await api().patch(`/api/groups/${g.id}/cabinet/${cab}`).set(o.auth).send({ expiresAt: d }), `expiresAt ${d}`);
    }
    await api().patch(`/api/groups/${g.id}/cabinet/${cab}`).set(o.auth).send({ expiresAt: "9999-12-31" }).expect(200);
  });
});

describe("scannedProductId", () => {
  it("[DEFECT M2-08] an unknown scannedProductId is 404 PRODUCT_NOT_FOUND, not 500 (once products FK exists)", async () => {
    // The shared DB now has migration 20261011050000_product_fks (FK scanned_product_id -> products). The service
    // doesn't check the product and errorHandler doesn't map P2003, so this is a 500. On a DB without the FK it is
    // silently stored instead (a dangling id).
    const r = await api().patch(`/api/groups/${g.id}/shopping-list/${row}`).set(o.auth).send({ checked: true, scannedProductId: randomUUID() });
    await expectRejected(r, "unknown scannedProductId");
  });
});

describe("cabinet photoKey", () => {
  it("[DEFECT M2-05] photoKey shape check: the '.' before the extension is a regex wildcard, so non-issued keys are accepted", async () => {
    // cabinet/service.ts builds the regex from a template literal: `\.` in a template is just ".", so it matches any char.
    const sneaky = `item-photo/${o.id}/${randomUUID()}Xjpg`;
    const r = await api().patch(`/api/groups/${g.id}/cabinet/${cab}`).set(o.auth).send({ photoKey: sneaky });
    expect(r.status).toBe(400);
  });

  it("other users' keys, traversal and avatar keys are rejected", async () => {
    for (const k of [`item-photo/${m.id}/${randomUUID()}.jpg`, `item-photo/${o.id}/../${m.id}/${randomUUID()}.jpg`, `avatar/${o.id}/${randomUUID()}.jpg`, `item-photo/${o.id}/${randomUUID()}.svg`]) {
      await expectRejected(await api().patch(`/api/groups/${g.id}/cabinet/${cab}`).set(o.auth).send({ photoKey: k }), k);
    }
  });
});
