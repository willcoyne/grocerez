import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { mailer } from "../src/lib/email.js";
import { api, DEMO_GROUP_ID, itemId, makeGroup, makeUser } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("03 groups", () => {
  it("POST /groups creates the group with the creator as owner; GET /groups lists it with role and count", async () => {
    const u = await makeUser();
    const res = await api().post("/api/groups").set(u.auth).send({ name: "  Hack Midwest House " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Hack Midwest House", role: "owner", memberCount: 1 });
    const list = await api().get("/api/groups").set(u.auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(res.body.id);

    const detail = await api().get(`/api/groups/${res.body.id}`).set(u.auth);
    expect(detail.status).toBe(200);
    expect(detail.body.members).toEqual([
      expect.objectContaining({ id: u.id, displayName: u.displayName, email: u.email, role: "owner" }),
    ]);
  });

  it("rename and delete are owner-only", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await makeGroup(owner, [member]);
    expect((await api().patch(`/api/groups/${g.id}`).set(member.auth).send({ name: "X" })).status).toBe(403);
    const ok = await api().patch(`/api/groups/${g.id}`).set(owner.auth).send({ name: "Renamed" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Renamed");
    expect((await api().delete(`/api/groups/${g.id}`).set(member.auth)).status).toBe(403);
    expect((await api().delete(`/api/groups/${g.id}`).set(owner.auth)).status).toBe(204);
    expect(await prisma.group.findUnique({ where: { id: g.id } })).toBeNull();
  });

  it("a non-member gets 404 on every /groups/:groupId route", async () => {
    const outsider = await makeUser();
    const paths: [string, string][] = [
      ["get", ""], ["patch", ""], ["delete", ""], ["get", "/invites"], ["post", "/invites"], ["post", "/leave"],
      ["get", "/preferences"], ["get", "/cabinet"], ["get", "/shopping-list"], ["post", "/shopping-list/generate"],
      ["post", "/shopping-list/complete"], ["delete", `/members/${randomUUID()}`],
    ];
    for (const [m, p] of paths) {
      const res = await (api() as unknown as Record<string, (u: string) => ReturnType<ReturnType<typeof api>["get"]>>)
        [m](`/api/groups/${DEMO_GROUP_ID}${p}`).set(outsider.auth).send({ name: "x", email: "a@b.co" });
      expect(res.status, `${m} ${p}`).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    // A malformed or unknown group id looks exactly the same.
    expect((await api().get(`/api/groups/not-a-uuid`).set(outsider.auth)).status).toBe(404);
    expect((await api().get(`/api/groups/${randomUUID()}`).set(outsider.auth)).status).toBe(404);
  });
});

describe("03 email invites", () => {
  it("full flow: invite → invitee sees it → accepts → is a member", async () => {
    const owner = await makeUser();
    const will = await makeUser({ email: `Will-${randomUUID().slice(0, 6)}@Example.com` });
    const g = await makeGroup(owner);
    const inv = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: `  ${will.email.toUpperCase()} ` });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ email: will.email, status: "pending", invitedBy: { id: owner.id } });

    const mine = await api().get("/api/me/invites").set(will.auth);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ id: inv.body.id, group: { id: g.id, name: "Test House", memberCount: 1 } });

    const acc = await api().post(`/api/invites/${inv.body.id}/accept`).set(will.auth);
    expect(acc.status).toBe(200);
    expect(acc.body).toMatchObject({ id: g.id, role: "member", memberCount: 2 });
    expect((await api().get(`/api/groups/${g.id}`).set(will.auth)).status).toBe(200);
    expect((await api().get("/api/me/invites").set(will.auth)).body).toHaveLength(0);
    // Accepting twice doesn't work.
    expect((await api().post(`/api/invites/${inv.body.id}/accept`).set(will.auth)).status).toBe(404);
  });

  it("an invite for someone else's email can't be seen or accepted (404 INVITE_NOT_FOUND)", async () => {
    const owner = await makeUser();
    const invitee = await makeUser();
    const other = await makeUser();
    const g = await makeGroup(owner);
    const inv = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: invitee.email });
    expect((await api().get("/api/me/invites").set(other.auth)).body).toHaveLength(0);
    const res = await api().post(`/api/invites/${inv.body.id}/accept`).set(other.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVITE_NOT_FOUND");
    expect((await api().post(`/api/invites/${inv.body.id}/decline`).set(other.auth)).status).toBe(404);
    // Even the owner can't accept an invite meant for someone else.
    expect((await api().post(`/api/invites/${inv.body.id}/accept`).set(owner.auth)).status).toBe(404);
  });

  it("re-inviting doesn't duplicate; it resets the row to pending", async () => {
    const owner = await makeUser();
    const invitee = await makeUser();
    const g = await makeGroup(owner);
    const a = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: invitee.email });
    await api().post(`/api/invites/${a.body.id}/decline`).set(invitee.auth).expect(204);
    const b = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: invitee.email });
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.status).toBe("pending");
    expect(b.body.respondedAt).toBeNull();
    expect(await prisma.groupInvite.count({ where: { groupId: g.id } })).toBe(1);
  });

  it("a revoked invite can't be accepted; revoke is owner-or-inviter and pending-only", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const third = await makeUser();
    const invitee = await makeUser();
    const g = await makeGroup(owner, [member, third]);
    const inv = await api().post(`/api/groups/${g.id}/invites`).set(member.auth).send({ email: invitee.email });

    const list = await api().get(`/api/groups/${g.id}/invites`).set(third.auth);
    expect(list.body.map((i: { id: string }) => i.id)).toEqual([inv.body.id]);
    expect(list.body[0].invitedBy.displayName).toBe(member.displayName);

    expect((await api().delete(`/api/groups/${g.id}/invites/${inv.body.id}`).set(third.auth)).status).toBe(403);
    expect((await api().delete(`/api/groups/${g.id}/invites/${inv.body.id}`).set(member.auth)).status).toBe(204);
    const again = await api().delete(`/api/groups/${g.id}/invites/${inv.body.id}`).set(owner.auth);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVITE_NOT_PENDING");

    expect((await api().post(`/api/invites/${inv.body.id}/accept`).set(invitee.auth)).status).toBe(404);
    expect((await api().get(`/api/groups/${g.id}/invites`).set(owner.auth)).body).toHaveLength(0);
    const all = await api().get(`/api/groups/${g.id}/invites?status=all`).set(owner.auth);
    expect(all.body[0].status).toBe("revoked");
  });

  it("the invite response is the same for known and unknown emails", async () => {
    const owner = await makeUser();
    const known = await makeUser();
    const g = await makeGroup(owner);
    const send = vi.spyOn(mailer, "send").mockResolvedValue();
    const unknownEmail = `nobody-${randomUUID().slice(0, 8)}@example.com`;
    const a = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: known.email });
    const b = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: unknownEmail });
    expect(a.status).toBe(b.status);
    const shape = (body: Record<string, unknown>) => Object.keys(body).sort();
    expect(shape(a.body)).toEqual(shape(b.body));
    const strip = (body: Record<string, unknown>) => ({ ...body, id: "", email: "", createdAt: "" });
    expect(strip(a.body)).toEqual(strip(b.body));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("inviting an existing member is 409 ALREADY_MEMBER; a bad email is 400", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await makeGroup(owner, [member]);
    const res = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: member.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_MEMBER");
    expect((await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: "not-an-email" })).status).toBe(400);
  });
});

describe("03 leave and remove", () => {
  it("leave deletes my preferences and hands ownership to the longest-standing member; last one out deletes the group", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const g = await makeGroup(owner, [a]);
    await prisma.groupMember.create({ data: { groupId: g.id, userId: b.id } });
    await prisma.preference.create({ data: { groupId: g.id, userId: owner.id, itemId: await itemId("Milk") } });

    expect((await api().post(`/api/groups/${g.id}/leave`).set(owner.auth)).status).toBe(204);
    expect(await prisma.preference.count({ where: { groupId: g.id, userId: owner.id } })).toBe(0);
    const roles = await prisma.groupMember.findMany({ where: { groupId: g.id }, orderBy: { joinedAt: "asc" } });
    expect(roles.map((r) => [r.userId, r.role])).toEqual([[a.id, "owner"], [b.id, "member"]]);

    await api().post(`/api/groups/${g.id}/leave`).set(b.auth).expect(204);
    await api().post(`/api/groups/${g.id}/leave`).set(a.auth).expect(204);
    expect(await prisma.group.findUnique({ where: { id: g.id } })).toBeNull();
  });

  it("remove member: owner only, not yourself; removes their preferences and revokes their invite", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const target = await makeUser();
    const g = await makeGroup(owner, [member]);
    const inv = await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: target.email });
    await api().post(`/api/invites/${inv.body.id}/accept`).set(target.auth).expect(200);
    await prisma.preference.create({ data: { groupId: g.id, userId: target.id, itemId: await itemId("Eggs") } });

    expect((await api().delete(`/api/groups/${g.id}/members/${target.id}`).set(member.auth)).status).toBe(403);
    const self = await api().delete(`/api/groups/${g.id}/members/${owner.id}`).set(owner.auth);
    expect(self.status).toBe(400);
    expect((await api().delete(`/api/groups/${g.id}/members/${randomUUID()}`).set(owner.auth)).status).toBe(404);

    expect((await api().delete(`/api/groups/${g.id}/members/${target.id}`).set(owner.auth)).status).toBe(204);
    expect(await prisma.groupMember.count({ where: { groupId: g.id, userId: target.id } })).toBe(0);
    expect(await prisma.preference.count({ where: { groupId: g.id, userId: target.id } })).toBe(0);
    expect((await prisma.groupInvite.findUnique({ where: { id: inv.body.id } }))?.status).toBe("revoked");
    expect((await api().post(`/api/invites/${inv.body.id}/accept`).set(target.auth)).status).toBe(404);
    expect((await api().get(`/api/groups/${g.id}`).set(target.auth)).status).toBe(404);
  });
});
