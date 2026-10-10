import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { Alerts } from "../src/contracts/alerts.js";
import { Group } from "../src/contracts/groups.js";
import { prisma } from "../src/db.js";
import { importRecalls } from "../src/jobs/importRecalls.js";
import * as realtime from "../src/lib/realtime.js";
import { recallsRepo } from "../src/modules/recalls/repo.js";
import { cleanupUsers, makeUser } from "./helpers.js";

// backend/09: alerts API + recall import job against the real DB; openFDA is a stubbed fetch, no network.
type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const emit = vi.spyOn(realtime, "emitGroup");
const tag = randomUUID().slice(0, 8).replace(/\d/g, "q"); // keeps catalog items unique; a recall must name it to match (all-words gate)
const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => ymd(new Date(Date.now() + n * DAY));

let owner: U, outsider: U, g: Group, other: Group;
let spinach: { id: string }, fish: { id: string }, soap: { id: string }, crackers: { id: string };

const mkItem = (name: string, category: string) =>
  prisma.item.create({ data: { name: `${name} ${tag}`, normalizedName: `${name.toLowerCase()} ${tag}`, category } });

// openFDA row (report_date YYYYMMDD).
const fdaRow = (n: string, description: string, daysAgo = 2) => ({
  recall_number: `F-${tag}-${n}`,
  product_description: description,
  reason_for_recall: "Possible Listeria monocytogenes contamination",
  classification: "Class I",
  recalling_firm: "Fresh Farms LLC",
  distribution_pattern: "Nationwide",
  report_date: ymd(new Date(Date.now() - daysAgo * DAY)).replaceAll("-", ""),
  status: "Ongoing",
});
const stubFetch = (rows: object[]) =>
  vi.fn(async (_url: string) => new Response(JSON.stringify({ meta: { results: { total: rows.length } }, results: rows }), { status: 200 }));

const JOB = `import-recalls-${tag}`; // own job_runs row: other files/agents share the default "import-recalls" row
const cleanRecalls = () => prisma.recall.deleteMany({ where: { externalId: { startsWith: `F-${tag}-` } } });

beforeAll(async () => {
  [owner, outsider] = await Promise.all([makeUser(), makeUser()]);
  spinach = await mkItem("Baby Spinach", "produce");
  fish = await mkItem("Salmon Fillet", "seafood");
  soap = await mkItem("Dish Soap", "household");
  crackers = await mkItem("Cheese Crackers", "snacks");
  g = Group.parse((await api().post("/api/groups").set(owner.auth).send({ name: "House" }).expect(201)).body);
  other = Group.parse((await api().post("/api/groups").set(outsider.auth).send({ name: "Elsewhere" }).expect(201)).body);
});

beforeEach(async () => {
  await cleanRecalls();
  for (const gid of [g.id, other.id]) {
    await prisma.shoppingListItem.deleteMany({ where: { groupId: gid } });
    await prisma.cabinetItem.deleteMany({ where: { groupId: gid } });
  }
  await prisma.jobRun.deleteMany({ where: { name: JOB } });
  emit.mockClear();
});

afterAll(async () => {
  await cleanRecalls();
  await prisma.jobRun.deleteMany({ where: { name: JOB } });
  await cleanupUsers();
  await prisma.product.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
  await prisma.item.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
  await prisma.$disconnect();
});

// Only this run's recalls: the shared dev DB may hold real openFDA recalls that also match "baby spinach".
const getAlerts = async (u = owner, gid = g.id) => {
  const a = Alerts.parse((await api().get(`/api/groups/${gid}/alerts`).set(u.auth).expect(200)).body);
  return { ...a, recalls: a.recalls.filter((r) => r.recall.externalId.startsWith(`F-${tag}-`)) };
};
const addToCabinet = async (u: U, gid: string, itemId: string, body: object = {}) =>
  (await api().post(`/api/groups/${gid}/cabinet`).set(u.auth).send({ itemId, ...body }).expect(200)).body as { id: string };

describe("alerts: expiring", () => {
  it("lists items expiring within 3 days (expired included), soonest first; nothing without a date or later", async () => {
    await addToCabinet(owner, g.id, spinach.id, { expiresAt: plusDays(3) });
    await addToCabinet(owner, g.id, crackers.id, { expiresAt: plusDays(-1) }); // already expired
    await addToCabinet(owner, g.id, soap.id); // household: no date
    await addToCabinet(outsider, other.id, fish.id, { expiresAt: plusDays(0) }); // other group
    const { expiring } = await getAlerts();
    expect(expiring.map((c) => [c.item.id, c.expiresAt])).toEqual([
      [crackers.id, plusDays(-1)],
      [spinach.id, plusDays(3)],
    ]);
    await api().patch(`/api/groups/${g.id}/cabinet/${expiring[1].id}`).set(owner.auth).send({ expiresAt: plusDays(4) }).expect(200);
    expect((await getAlerts()).expiring.map((c) => c.item.id)).toEqual([crackers.id]);
  });

  it("every bought item gets an expiration date at finish trip (estimated), and a 2-day seafood item shows up", async () => {
    for (const it of [fish, crackers]) await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: it.id }).expect(200);
    const list = (await api().get(`/api/groups/${g.id}/shopping-list`).set(owner.auth).expect(200)).body as { id: string }[];
    for (const r of list) await api().patch(`/api/groups/${g.id}/shopping-list/${r.id}`).set(owner.auth).send({ checked: true }).expect(200);
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(owner.auth).expect(200);
    const cab = await prisma.cabinetItem.findMany({ where: { groupId: g.id } });
    expect(cab.map((c) => c.expirationSource)).toEqual(["estimated", "estimated"]);
    expect(cab.every((c) => c.expiresAt)).toBe(true);
    const { expiring } = await getAlerts();
    expect(expiring.map((c) => [c.item.id, c.expiresAt, c.expirationSource])).toEqual([[fish.id, plusDays(2), "estimated"]]);
  });
});

describe("alerts: recalls", () => {
  it("the fake recall matches on cabinet add, shows as an alert, and can be dismissed (group-scoped)", async () => {
    // The seeded fake recall (database/10 doesn't exist on this branch, so the test inserts it).
    await prisma.recall.create({
      data: {
        source: "openfda",
        externalId: `F-${tag}-SEED`,
        productDescription: `Fresh Farms Organic Baby Spinach ${tag}, 5 oz clamshell, UPC 0 12345 67890 1`,
        reason: "Possible Salmonella",
        classification: "Class II",
        firm: "Fresh Farms LLC",
        reportDate: new Date(`${plusDays(-200)}T00:00:00Z`), // old recall: a cabinet add still catches it
        status: "Ongoing",
      },
    });
    await addToCabinet(outsider, other.id, crackers.id); // unrelated item, other group
    const cab = await addToCabinet(owner, g.id, spinach.id);
    expect(emit.mock.calls.map((c) => c[1])).toContain("cabinet:changed");

    const { recalls } = await getAlerts();
    expect(recalls).toHaveLength(1);
    expect(recalls[0]).toMatchObject({
      cabinetItemId: cab.id,
      item: { id: spinach.id },
      recall: { externalId: `F-${tag}-SEED`, reason: "Possible Salmonella", classification: "Class II", firm: "Fresh Farms LLC", reportDate: plusDays(-200) },
    });
    expect(recalls[0].recall.link).toContain(encodeURIComponent(`F-${tag}-SEED`));
    expect(recalls[0].score).toBeGreaterThanOrEqual(0.35);
    expect((await getAlerts(outsider, other.id)).recalls).toEqual([]);

    // Re-adding the same item doesn't duplicate the match.
    await addToCabinet(owner, g.id, spinach.id);
    expect((await getAlerts()).recalls).toHaveLength(1);

    const dismissUrl = (gid: string, id: string) => `/api/groups/${gid}/alerts/recalls/${id}/dismiss`;
    await api().post(dismissUrl(g.id, recalls[0].id)).set(outsider.auth).expect(404); // not a member
    const wrong = await api().post(dismissUrl(other.id, recalls[0].id)).set(outsider.auth).expect(404); // another group's match
    expect(wrong.body.error.code).toBe("RECALL_MATCH_NOT_FOUND");
    await api().post(dismissUrl(g.id, "nope")).set(owner.auth).expect(400);
    expect((await getAlerts()).recalls).toHaveLength(1);

    emit.mockClear();
    await api().post(dismissUrl(g.id, recalls[0].id)).set(owner.auth).expect(204);
    expect(emit).toHaveBeenCalledWith(g.id, "cabinet:changed", owner.id);
    expect((await getAlerts()).recalls).toEqual([]);
    await addToCabinet(owner, g.id, spinach.id); // still dismissed after a re-add
    expect((await getAlerts()).recalls).toEqual([]);
    expect(await prisma.cabinetItem.count({ where: { groupId: g.id } })).toBe(1); // never deletes items
  });

  it("brand gate: a scanned product's brand must appear in the description", async () => {
    const dole = await prisma.product.create({ data: { name: `Baby Spinach ${tag}`, brand: "Dole", source: "manual", fetchedAt: new Date() } });
    await prisma.recall.create({
      data: { source: "openfda", externalId: `F-${tag}-OG`, productDescription: `Organic Girl Baby Spinach ${tag} 5 oz` },
    });
    // Bought with the scanned Dole product: the generic name matches, but "Dole" isn't in the description.
    await api().post(`/api/groups/${g.id}/shopping-list`).set(owner.auth).send({ itemId: spinach.id }).expect(200);
    const [row] = (await api().get(`/api/groups/${g.id}/shopping-list`).set(owner.auth).expect(200)).body as { id: string }[];
    await api().patch(`/api/groups/${g.id}/shopping-list/${row.id}`).set(owner.auth).send({ checked: true, scannedProductId: dole.id }).expect(200);
    await api().post(`/api/groups/${g.id}/shopping-list/complete`).set(owner.auth).expect(200);
    expect((await getAlerts()).recalls).toEqual([]);

    await prisma.recall.create({
      data: { source: "openfda", externalId: `F-${tag}-DOLE`, productDescription: `DOLE Baby Spinach ${tag}, 10 oz bag` },
    });
    await addToCabinet(owner, g.id, spinach.id); // per-item re-match on add
    expect((await getAlerts()).recalls.map((r) => r.recall.externalId)).toEqual([`F-${tag}-DOLE`]);
  });
});

describe("recall matching precision and races", () => {
  it("a multi-word name needs all its significant words: one shared word is not a match, a long description is", async () => {
    await prisma.recall.createMany({
      data: [
        // Old rule (strict_word_similarity alone) matched "Cheese Crackers" here via "cheese <tag>".
        { source: "openfda", externalId: `F-${tag}-CHZ`, productDescription: `Sliced cheese ${tag}, cheddar, 8 oz` },
        {
          source: "openfda",
          externalId: `F-${tag}-LONG`,
          productDescription: `Fresh Farms brand Organic Baby Spinach ${tag} in 5 oz and 10 oz plastic clamshells and 1 lb bags, sold at retail stores nationwide, UPC 0 12345 67890 1, best by dates through 11/30`,
        },
        { source: "openfda", externalId: `F-${tag}-CRK`, productDescription: `Cheese Cracker ${tag} sandwiches, 12 pack` }, // plural tolerance
      ],
    });
    await addToCabinet(owner, g.id, crackers.id);
    await addToCabinet(owner, g.id, spinach.id);
    const ids = (await getAlerts()).recalls.map((r) => [r.recall.externalId, r.item.id]).sort();
    expect(ids).toEqual([[`F-${tag}-CRK`, crackers.id], [`F-${tag}-LONG`, spinach.id]].sort());
  });

  it("a cabinet item deleted while matching runs is skipped, not an FK error", async () => {
    await prisma.recall.create({ data: { source: "openfda", externalId: `F-${tag}-RACE`, productDescription: `Baby Spinach ${tag}` } });
    const cab = await prisma.cabinetItem.create({ data: { groupId: g.id, itemId: spinach.id } });
    let release!: () => void;
    let deleted!: () => void;
    const isDeleted = new Promise<void>((r) => (deleted = r));
    // Delete inside an open transaction; matching starts before it commits.
    const del = prisma.$transaction(async (tx) => {
      await tx.cabinetItem.delete({ where: { id: cab.id } });
      deleted();
      await new Promise<void>((r) => (release = r));
    });
    await isDeleted;
    const match = recallsRepo.match({ cabinetItemIds: [cab.id] });
    setTimeout(() => release(), 300);
    await del;
    expect(await match).toEqual([]);
    expect(await prisma.recallMatch.count({ where: { cabinetItemId: cab.id } })).toBe(0);
  });
});

describe("importRecalls job", () => {
  it("imports, matches, and running twice creates no duplicates; the second run starts from the last import", async () => {
    await addToCabinet(owner, g.id, spinach.id);
    await addToCabinet(owner, g.id, fish.id);
    const rows = [
      fdaRow("1", `Fresh Farms Baby Spinach ${tag} 10 oz`),
      fdaRow("2", `Atlantic Salmon Fillet ${tag}, frozen, 1 lb`),
      fdaRow("3", `Peanut butter cups`), // matches nothing
      { recall_number: `F-${tag}-BAD` }, // malformed: dropped
    ];
    const t1 = new Date();
    const f1 = stubFetch(rows);
    emit.mockClear();
    expect(await importRecalls({ now: t1, fetch: f1 as unknown as typeof fetch, job: JOB })).toMatchObject({ imported: 3 });
    expect(f1.mock.calls[0][0]).toContain(`report_date:[${ymd(new Date(t1.getTime() - 30 * DAY)).replaceAll("-", "")}+TO+`);
    expect(emit).toHaveBeenCalledWith(g.id, "cabinet:changed", "system");
    const first = await getAlerts();
    expect(first.recalls.map((r) => r.item.id).sort()).toEqual([spinach.id, fish.id].sort());

    const t2 = new Date(t1.getTime() + DAY);
    const f2 = stubFetch(rows.slice(0, 3).map((r) => ({ ...r, status: "Terminated" })));
    emit.mockClear();
    await importRecalls({ now: t2, fetch: f2 as unknown as typeof fetch, job: JOB });
    expect(f2.mock.calls[0][0]).toContain(`report_date:[${ymd(t1).replaceAll("-", "")}+TO+${ymd(t2).replaceAll("-", "")}]`);
    expect(await prisma.recall.count({ where: { externalId: { startsWith: `F-${tag}-` } } })).toBe(3);
    expect(await prisma.recall.findUniqueOrThrow({ where: { externalId: `F-${tag}-1` } })).toMatchObject({ status: "Terminated" });
    const second = await getAlerts();
    expect(second.recalls.map((r) => r.id).sort()).toEqual(first.recalls.map((r) => r.id).sort());
    expect(emit).not.toHaveBeenCalledWith(g.id, "cabinet:changed", "system"); // no new matches
  });

  it("an upstream failure doesn't advance the last-import date", async () => {
    const bad = vi.fn(async () => new Response("oops", { status: 500 }));
    await expect(importRecalls({ fetch: bad as unknown as typeof fetch, job: JOB })).rejects.toThrow(/openFDA 500/);
    expect(await prisma.jobRun.findUnique({ where: { name: JOB } })).toBeNull();
  });
});
