import { randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { prisma } from "../../src/db.js";
import { ai } from "../../src/lib/anthropic.js";
import { mailer } from "../../src/lib/email.js";
import { http } from "../../src/lib/http.js";
import { api, itemId, makeGroup, makeUser, type TestUser } from "../helpers.js";

export * from "../helpers.js";

/** The real global fetch, captured before any test stubs it (used only to reach local 127.0.0.1 test servers). */
export const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

/**
 * Blocks every outbound call: the app's single HTTP seam (`http.fetch`), the global fetch (except 127.0.0.1 test
 * servers), Resend, and Claude. Tests that need a stubbed upstream override these spies afterwards.
 * Returns the spies so tests can assert "never called".
 */
export function guardNetwork() {
  const blocked = (what: string) => {
    throw new Error(`network blocked in break tests: ${what}`);
  };
  const httpFetch = vi.spyOn(http, "fetch").mockImplementation(async (url: string) => blocked(`http.fetch ${url}`));
  const globalFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/^http:\/\/127\.0\.0\.1[:/]/.test(url)) return realFetch(input, init);
    return blocked(`fetch ${url}`);
  });
  const mail = vi.spyOn(mailer, "send").mockResolvedValue(undefined);
  const claude = vi.spyOn(ai, "call").mockImplementation(async () => blocked("Claude"));
  return { httpFetch, globalFetch, mail, claude };
}

/** Every error must be {error:{code,message}} with the matching status, no stack traces, no internals. */
export function expectErrorShape(res: { status: number; body: unknown; text?: string }, status?: number, code?: string) {
  if (status !== undefined) expect(res.status, JSON.stringify(res.body)).toBe(status);
  const body = res.body as { error?: { code?: unknown; message?: unknown } };
  expect(body && typeof body === "object", `body: ${res.text}`).toBe(true);
  expect(typeof body.error?.code, `body: ${JSON.stringify(body)}`).toBe("string");
  expect(typeof body.error?.message).toBe("string");
  if (code !== undefined) expect(body.error?.code).toBe(code);
  const text = JSON.stringify(res.body);
  expect(text).not.toMatch(/\bat .+\(.+:\d+:\d+\)|node_modules|\/src\/|prisma\.|Invalid `|stack/i);
}

export const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
export const tag = () => randomUUID().slice(0, 8);

/** A household with one row of every kind of group data, so cross-household tests have real ids to aim at. */
export type Household = {
  owner: TestUser;
  member: TestUser;
  group: { id: string; name: string };
  prefId: string;
  memberPrefId: string;
  cabinetId: string;
  listPrefRowId: string;
  listManualRowId: string;
  inviteId: string;
  inviteEmail: string;
  recallMatchId: string;
};

export async function makeHousehold(name = "House"): Promise<Household> {
  const owner = await makeUser();
  const member = await makeUser();
  const group = await makeGroup(owner, [member], `${name} ${tag()}`);
  const g = `/api/groups/${group.id}`;
  const milk = await itemId("Milk");
  const bread = await itemId("Bread");
  const eggs = await itemId("Eggs");
  const spinach = await itemId("Spinach");

  const pref = await api().post(`${g}/preferences`).set(owner.auth).send({ itemId: milk, quantityText: "1 gal" });
  const memberPref = await api().post(`${g}/preferences`).set(member.auth).send({ itemId: bread });
  const cab = await api().post(`${g}/cabinet`).set(owner.auth).send({ itemId: spinach, location: "fridge" });
  const manual = await api().post(`${g}/shopping-list`).set(owner.auth).send({ itemId: eggs });
  const list = await api().get(`${g}/shopping-list`).set(owner.auth);
  const inviteEmail = `invitee-${tag()}@example.com`;
  const inv = await api().post(`${g}/invites`).set(owner.auth).send({ email: inviteEmail });
  for (const r of [pref, memberPref, cab, manual, inv]) {
    if (r.status >= 300) throw new Error(`household setup failed: ${r.status} ${JSON.stringify(r.body)}`);
  }

  const recall = await prisma.recall.create({
    data: { source: "openfda", externalId: `BRK-${tag()}`, productDescription: "Fresh spinach, 10 oz bags", reason: "Listeria" },
  });
  const match = await prisma.recallMatch.create({
    data: { recallId: recall.id, groupId: group.id, cabinetItemId: cab.body.id, score: 0.9 },
  });

  const listPrefRow = (list.body as { id: string; itemId: string }[]).find((r) => r.itemId === milk);
  if (!listPrefRow) throw new Error("expected Milk on the list");
  return {
    owner, member, group,
    prefId: pref.body.id, memberPrefId: memberPref.body.id, cabinetId: cab.body.id,
    listPrefRowId: listPrefRow.id, listManualRowId: manual.body.id,
    inviteId: inv.body.id, inviteEmail, recallMatchId: match.id,
  };
}

/** A snapshot of everything a household owns, to prove a rejected request changed nothing. */
export async function snapshot(groupId: string) {
  const [group, members, prefs, cabinet, list, invites, matches] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId } }),
    prisma.groupMember.findMany({ where: { groupId }, orderBy: { userId: "asc" } }),
    prisma.preference.findMany({ where: { groupId }, orderBy: { id: "asc" } }),
    prisma.cabinetItem.findMany({ where: { groupId }, orderBy: { id: "asc" } }),
    prisma.shoppingListItem.findMany({ where: { groupId }, orderBy: { id: "asc" } }),
    prisma.groupInvite.findMany({ where: { groupId }, orderBy: { id: "asc" } }),
    prisma.recallMatch.findMany({ where: { groupId }, orderBy: { id: "asc" } }),
  ]);
  return JSON.parse(JSON.stringify({ group, members, prefs, cabinet, list, invites, matches }));
}
