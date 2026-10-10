// Break tests (M3/M4): alerts API, recall import job, recall matching and expiring edge cases (plan backend/09).
// Real app + local Postgres; openFDA is a stubbed fetch. Tests named "[DEFECT M3-xx]" are expected to FAIL.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../../src/app.js";
import { Alerts } from "../../../src/contracts/alerts.js";
import { Group } from "../../../src/contracts/groups.js";
import { prisma } from "../../../src/db.js";
import { importRecalls } from "../../../src/jobs/importRecalls.js";
import * as realtime from "../../../src/lib/realtime.js";
import { brandAppears, matchRecalls, strictWordSimilarity, MATCH_THRESHOLD } from "../../../src/modules/recalls/match.js";
import { cleanupUsers, makeUser } from "../../helpers.js";

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const emit = vi.spyOn(realtime, "emitGroup");
// Letters only and unusual words, so neither real recalls in the shared DB nor other testers' rows score against them.
const tag = randomUUID().replace(/[^a-f]/g, "").slice(0, 6) + "zq";
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => ymd(new Date(Date.now() + n * DAY));
const ext = (n: string) => `F-BRK-${tag}-${n}`;

let a: U, b: U, gA: Group, gB: Group;
let zorb: { id: string }, quix: { id: string };

const mkItem = (name: string, category: string | null = "snacks") =>
  prisma.item.create({ data: { name: `${name} ${tag}`, normalizedName: `${name.toLowerCase()} ${tag}`, category } });
const addToCabinet = async (u: U, gid: string, itemId: string, body: object = {}) =>
  (await api().post(`/api/groups/${gid}/cabinet`).set(u.auth).send({ itemId, ...body }).expect(200)).body as { id: string };
const mkRecall = (n: string, description: string, daysAgo = 2) =>
  prisma.recall.create({
    data: { source: "openfda", externalId: ext(n), productDescription: description, reportDate: new Date(`${plusDays(-daysAgo)}T00:00:00Z`) },
  });
const myRecalls = (alerts: Alerts) => alerts.recalls.filter((r) => r.recall.externalId.startsWith(`F-BRK-${tag}-`));
const getAlerts = async (u: U, gid: string) => Alerts.parse((await api().get(`/api/groups/${gid}/alerts`).set(u.auth).expect(200)).body);

const expectErrorShape = (res: request.Response, status: number, code?: string) => {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(["error"]);
  expect(Object.keys(res.body.error).sort()).toEqual(["code", "message"]);
  if (code) expect(res.body.error.code).toBe(code);
};

beforeAll(async () => {
  [a, b] = await Promise.all([makeUser(), makeUser()]);
  zorb = await mkItem("Zorblax Crisps");
  quix = await mkItem("Quixotic Jam", "pantry");
  gA = Group.parse((await api().post("/api/groups").set(a.auth).send({ name: "A house" }).expect(201)).body);
  gB = Group.parse((await api().post("/api/groups").set(b.auth).send({ name: "B house" }).expect(201)).body);
});
beforeEach(async () => {
  emit.mockClear();
  await prisma.recall.deleteMany({ where: { externalId: { startsWith: `F-BRK-${tag}-` } } });
  await prisma.cabinetItem.deleteMany({ where: { groupId: { in: [gA.id, gB.id] } } });
});
afterAll(async () => {
  await prisma.recall.deleteMany({ where: { externalId: { startsWith: `F-BRK-${tag}-` } } });
  await cleanupUsers();
  await prisma.item.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
});

describe("alerts: cross-household", () => {
  it("B can't see, read or dismiss A's recall match by any path", async () => {
    await mkRecall("X1", `Zorblax Crisps ${tag}, 4 oz bag`);
    await addToCabinet(a, gA.id, zorb.id);
    const [match] = myRecalls(await getAlerts(a, gA.id));
    expect(match).toBeDefined();

    expect(myRecalls(await getAlerts(b, gB.id))).toEqual([]);
    expectErrorShape(await api().get(`/api/groups/${gA.id}/alerts`).set(b.auth), 404, "NOT_FOUND");
    expectErrorShape(await api().post(`/api/groups/${gA.id}/alerts/recalls/${match.id}/dismiss`).set(b.auth), 404, "NOT_FOUND");
    expectErrorShape(await api().post(`/api/groups/${gB.id}/alerts/recalls/${match.id}/dismiss`).set(b.auth), 404, "RECALL_MATCH_NOT_FOUND");
    expect(myRecalls(await getAlerts(a, gA.id)).map((m) => m.id)).toEqual([match.id]); // still open
    expect(emit).not.toHaveBeenCalledWith(gA.id, "cabinet:changed", b.id);
  });

  it("no token / bad ids -> standard errors", async () => {
    expectErrorShape(await api().get(`/api/groups/${gA.id}/alerts`), 401, "UNAUTHENTICATED");
    expectErrorShape(await api().get(`/api/groups/not-a-uuid/alerts`).set(a.auth), 404);
    expectErrorShape(await api().post(`/api/groups/${gA.id}/alerts/recalls/not-a-uuid/dismiss`).set(a.auth), 400, "VALIDATION_ERROR");
    expectErrorShape(await api().post(`/api/groups/${gA.id}/alerts/recalls/${randomUUID()}/dismiss`).set(a.auth), 404, "RECALL_MATCH_NOT_FOUND");
    expectErrorShape(await api().post(`/api/groups/${gA.id}/alerts/recalls/'%20OR%201=1--/dismiss`).set(a.auth), 400);
  });

  it("[DEFECT M3-06] an upper-case groupId passes membership, but the realtime event goes to a room nobody joined", async () => {
    await mkRecall("X2", `Zorblax Crisps ${tag} family size`);
    await addToCabinet(a, gA.id, zorb.id);
    const [match] = myRecalls(await getAlerts(a, gA.id));
    emit.mockClear();
    const res = await api().post(`/api/groups/${gA.id.toUpperCase()}/alerts/recalls/${match.id}/dismiss`).set(a.auth);
    expect(res.status).toBe(204);
    // Sockets join `group:<lower-case id>`; emitting to `group:<UPPER>` reaches no one, so other members' badges never refresh.
    expect(emit).toHaveBeenCalledWith(gA.id, "cabinet:changed", a.id);
  });
});

describe("expiring: date edge cases", () => {
  it("past, today, +3 included; +4 and null excluded; soonest first", async () => {
    const z = await addToCabinet(a, gA.id, zorb.id, { expiresAt: plusDays(-400) });
    const q = await addToCabinet(a, gA.id, quix.id, { expiresAt: plusDays(3) });
    let ids = (await getAlerts(a, gA.id)).expiring.map((c) => c.id);
    expect(ids).toEqual([z.id, q.id]);
    await api().patch(`/api/groups/${gA.id}/cabinet/${q.id}`).set(a.auth).send({ expiresAt: plusDays(4) }).expect(200);
    await api().patch(`/api/groups/${gA.id}/cabinet/${z.id}`).set(a.auth).send({ expiresAt: null }).expect(200);
    ids = (await getAlerts(a, gA.id)).expiring.map((c) => c.id);
    expect(ids).toEqual([]);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-1-1", "26-01-01", "2026-01-01T00:00:00Z", "", "tomorrow", 20260101, "+02026-01-01"])(
    "expiresAt %j -> 400 VALIDATION_ERROR",
    async (expiresAt) => {
      const c = await addToCabinet(a, gA.id, zorb.id);
      expectErrorShape(await api().patch(`/api/groups/${gA.id}/cabinet/${c.id}`).set(a.auth).send({ expiresAt }), 400, "VALIDATION_ERROR");
    },
  );

  it.each(["0000-01-01", "0001-01-01", "9999-12-31", "1900-02-29", "2028-02-29"])("expiresAt %s never 500s", async (expiresAt) => {
    const c = await addToCabinet(a, gA.id, zorb.id);
    const res = await api().patch(`/api/groups/${gA.id}/cabinet/${c.id}`).set(a.auth).send({ expiresAt });
    expect(res.status).not.toBe(500);
    if (res.status === 200) expect(res.body.expiresAt).toBe(expiresAt);
  });
});

// ---- import job (openFDA stubbed)
const fdaRow = (n: string, description: string, over: object = {}) => ({
  recall_number: ext(n),
  product_description: description,
  reason_for_recall: "Undeclared peanuts",
  classification: "Class I",
  recalling_firm: "Acme",
  report_date: ymd(new Date(Date.now() - 2 * DAY)).replaceAll("-", ""),
  status: "Ongoing",
  ...over,
});
const page = (rows: unknown[]) => new Response(JSON.stringify({ meta: { results: { total: rows.length } }, results: rows }), { status: 200 });
const stub = (rows: unknown[]) => vi.fn(async (_u: string) => page(rows));
const imported = () => prisma.recall.findMany({ where: { externalId: { startsWith: `F-BRK-${tag}-` } }, select: { externalId: true } });

describe("recall import job", () => {
  it("malformed rows are skipped, valid rows still import", async () => {
    const rows = [fdaRow("OK1", "Quixotic Jam strawberry"), { recall_number: 5 }, null, "x", { product_description: "no number" }, fdaRow("OK2", "Other")];
    await importRecalls({ fetch: stub(rows) as unknown as typeof fetch });
    expect((await imported()).map((r) => r.externalId).sort()).toEqual([ext("OK1"), ext("OK2")]);
  });

  it("two imports at once: both succeed, no duplicates", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => fdaRow(`C${i}`, `Concurrent product ${i}`));
    const r = await Promise.allSettled([importRecalls({ fetch: stub(rows) as unknown as typeof fetch }), importRecalls({ fetch: stub(rows) as unknown as typeof fetch })]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await imported()).length).toBe(20);
  });

  it("[DEFECT M3-07] one row with an impossible report_date (passes the regex) makes the whole import fail, so no recall is ever imported", async () => {
    const rows = [fdaRow("D1", "Quixotic Jam grape"), fdaRow("D2", "Bad date row", { report_date: "20261399" })];
    await importRecalls({ fetch: stub(rows) as unknown as typeof fetch }).catch(() => {});
    expect((await imported()).map((r) => r.externalId)).toContain(ext("D1"));
  });

  it("[DEFECT M3-07] one row with a NUL byte in product_description makes the whole import fail", async () => {
    const rows = [fdaRow("N1", "Quixotic Jam peach"), fdaRow("N2", "Bad\u0000row")];
    await importRecalls({ fetch: stub(rows) as unknown as typeof fetch }).catch(() => {});
    expect((await imported()).map((r) => r.externalId)).toContain(ext("N1"));
  });

  it("[DEFECT M3-08] a recall openFDA publishes a few days after its report_date is never imported (since = last run time)", async () => {
    const before = await prisma.jobRun.findUnique({ where: { name: "import-recalls" } });
    const day1 = new Date();
    const day2 = new Date(day1.getTime() + DAY);
    // openFDA updates the enforcement data weekly: on day 2 a recall with report_date = day1 - 3 appears.
    const late = fdaRow("LATE", "Quixotic Jam apricot", { report_date: ymd(new Date(day1.getTime() - 3 * DAY)).replaceAll("-", "") });
    const rangeFetch = (published: unknown[]) =>
      vi.fn(async (url: string) => {
        const [, from, to] = url.match(/report_date:\[(\d{8})\+TO\+(\d{8})\]/)!;
        return page(published.filter((r: any) => r.report_date >= from && r.report_date <= to));
      });
    try {
      await importRecalls({ now: day1, fetch: rangeFetch([]) as unknown as typeof fetch });
      await prisma.jobRun.update({ where: { name: "import-recalls" }, data: { lastSuccessAt: day1 } }); // pin against parallel files
      await importRecalls({ now: day2, fetch: rangeFetch([late]) as unknown as typeof fetch });
      expect((await imported()).map((r) => r.externalId)).toContain(ext("LATE"));
    } finally {
      if (before) await prisma.jobRun.update({ where: { name: "import-recalls" }, data: { lastSuccessAt: before.lastSuccessAt } });
      else await prisma.jobRun.deleteMany({ where: { name: "import-recalls" } });
    }
  });
});

// ---- matching quality. match.ts mirrors the SQL (strict_word_similarity >= 0.35, brand gate applied in JS in both).
describe("recall matching quality (quantified; 0.35 is known-noisy)", () => {
  const recalls = [
    "Peanut Butter, Creamy, 16 oz jar", "Ice Cream, Vanilla Bean, 1.5 qt", "Rice Krispies Treats bars, 8 ct", "Egg Noodles, wide, 12 oz bag",
    "Italian style bread crumbs, 15 oz", "Corn dogs, frozen, 6 ct", "Chicken flavor ramen noodle soup", "Apple juice from concentrate, 64 fl oz",
    "Whole milk chocolate bar with almonds", "Cheddar cheese crackers", "Fresh baby spinach, 5 oz clamshell", "Romaine lettuce hearts, 3 count",
    "Ground beef 80% lean, 1 lb", "Frozen sweet peas, 12 oz", "Cantaloupe, whole",
  ];
  // [cabinet item name, recalls that really are that product]
  const truth: [string, string[]][] = [
    ["Peanut butter", ["Peanut Butter"]], ["Butter", []], ["Cream", []], ["Ice cream", ["Ice Cream"]], ["Rice", []], ["Eggs", []],
    ["Egg noodles", ["Egg Noodles"]], ["Bread", []], ["Corn", []], ["Chicken", []], ["Apple", []], ["Apple juice", ["Apple juice"]],
    ["Milk", []], ["Chocolate", ["Whole milk chocolate"]], ["Cheese", []], ["Crackers", ["Cheddar cheese crackers"]],
    ["Spinach", ["Fresh baby spinach"]], ["Lettuce", ["Romaine lettuce"]], ["Ground beef", ["Ground beef"]], ["Peas", ["Frozen sweet peas"]],
    ["Cantaloupe", ["Cantaloupe"]], ["Beef jerky", []], ["Sweet potato", []], ["Milk chocolate", ["Whole milk chocolate"]],
  ];

  it("unbranded items: precision ~44% (15 of 27 flagged pairs are false alarms), recall 100%", () => {
    let tp = 0, fp = 0, fn = 0;
    const falseAlarms: string[] = [];
    for (const [item, real] of truth) {
      for (const r of recalls) {
        const hit = strictWordSimilarity(item, r) >= MATCH_THRESHOLD;
        const isReal = real.some((p) => r.startsWith(p));
        if (hit && isReal) tp++;
        else if (hit) { fp++; falseAlarms.push(`${item} ~ ${r}`); }
        else if (isReal) fn++;
      }
    }
    // Documented, not a defect test: e.g. "Butter ~ Peanut Butter", "Cream ~ Peanut Butter, Creamy", "Sweet potato ~ Frozen sweet peas".
    expect({ tp, fp, fn }).toEqual({ tp: 12, fp: 15, fn: 0 });
    expect(falseAlarms).toContain("Sweet potato ~ Frozen sweet peas, 12 oz");
  });

  it.each([
    ["Trader Joe's", "Organic Baby Spinach, TRADER JOES, 6 oz"],
    ["Kellogg's", "Frosted Flakes cereal, Kellogg Company, 24 oz"],
    ["Häagen-Dazs", "Haagen-Dazs vanilla ice cream pint"],
    ["Kraft Heinz", "Kraft Macaroni & Cheese Dinner, 7.25 oz"],
  ])("[DEFECT M3-09] brand %j vs %j: the brand gate drops a real recall (false negative)", (brand, description) => {
    const productName = description.split(",")[0].replace(/TRADER JOES|Kellogg Company|Haagen-Dazs|Kraft/gi, "").trim();
    const m = matchRecalls([{ id: "r", productDescription: description }], [{ id: "c", groupId: "g", itemName: productName, brand, productName }]);
    expect(m).toHaveLength(1);
  });

  it("brand gate still works for exact spellings (control)", () => {
    expect(brandAppears("Ben & Jerry's", "BEN & JERRY'S ice cream")).toBe(true);
    expect(brandAppears("Dole", "Dole Fresh Vegetables salad")).toBe(true);
  });
});
