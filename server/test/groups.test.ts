import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { Group, GroupDetail, Invite, MyInvite } from "../src/contracts/groups.js";
import { prisma } from "../src/db.js";
import { cleanupUsers, makeUser } from "./helpers.js";

afterAll(async () => {
  await cleanupUsers();
  await prisma.$disconnect();
});

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const newGroup = async (u: U, name = "Hack Midwest House") =>
  Group.parse((await api().post("/api/groups").set(u.auth).send({ name }).expect(201)).body);
const invite = (u: U, groupId: string, email: string) => api().post(`/api/groups/${groupId}/invites`).set(u.auth).send({ email });
const accept = (u: U, inviteId: string) => api().post(`/api/invites/${inviteId}/accept`).set(u.auth);
// Owner creates a group, invites `member`, member accepts.
async function groupWith(owner: U, ...members: U[]) {
  const g = await newGroup(owner);
  for (const m of members) {
    const inv = Invite.parse((await invite(owner, g.id, m.email).expect(201)).body);
    await accept(m, inv.id).expect(200);
  }
  return g;
}

describe("groups", () => {
  it("creates a group with the creator as owner, lists and shows it", async () => {
    const owner = await makeUser();
    const g = await newGroup(owner);
    expect(g).toMatchObject({ name: "Hack Midwest House", role: "owner", memberCount: 1 });

    const list = (await api().get("/api/groups").set(owner.auth).expect(200)).body;
    expect(list.map(Group.parse)).toEqual([g]);

    const detail = GroupDetail.parse((await api().get(`/api/groups/${g.id}`).set(owner.auth).expect(200)).body);
    expect(detail.members).toEqual([{ id: owner.id, displayName: expect.any(String), email: owner.email, avatarUrl: null, role: "owner" }]);
  });

  it("rename and delete are owner-only", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await groupWith(owner, member);

    expect((await api().patch(`/api/groups/${g.id}`).set(member.auth).send({ name: "X" })).status).toBe(403);
    expect((await api().delete(`/api/groups/${g.id}`).set(member.auth)).status).toBe(403);

    const renamed = Group.parse((await api().patch(`/api/groups/${g.id}`).set(owner.auth).send({ name: " Home " }).expect(200)).body);
    expect(renamed).toMatchObject({ name: "Home", memberCount: 2, role: "owner" });

    await api().delete(`/api/groups/${g.id}`).set(owner.auth).expect(204);
    expect(await prisma.group.count({ where: { id: g.id } })).toBe(0);
    expect(await prisma.groupMember.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("a non-member gets 404 on every /groups/:groupId route", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const g = await newGroup(owner);
    const inv = Invite.parse((await invite(owner, g.id, `x-${randomUUID()}@example.com`)).body);
    const calls = [
      api().get(`/api/groups/${g.id}`),
      api().patch(`/api/groups/${g.id}`).send({ name: "pwned" }),
      api().delete(`/api/groups/${g.id}`),
      api().get(`/api/groups/${g.id}/invites`),
      api().post(`/api/groups/${g.id}/invites`).send({ email: outsider.email }),
      api().delete(`/api/groups/${g.id}/invites/${inv.id}`),
      api().post(`/api/groups/${g.id}/leave`),
      api().delete(`/api/groups/${g.id}/members/${owner.id}`),
      api().get(`/api/groups/${g.id}/shopping-list`), // routers added later are covered too
      api().get(`/api/groups/not-a-uuid`),
    ];
    for (const call of calls) {
      const res = await call.set(outsider.auth);
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Group not found" });
    }
    expect(await prisma.group.findUnique({ where: { id: g.id } })).toMatchObject({ name: "Hack Midwest House" });
    expect((await api().get("/api/groups").set(outsider.auth)).body).toEqual([]);
  });
});

describe("email invites", () => {
  it("only the Google account with the invited email sees and accepts the invite", async () => {
    const owner = await makeUser();
    const will = await makeUser(`will-${randomUUID()}@example.com`);
    const other = await makeUser();
    const g = await newGroup(owner);

    const res = await invite(owner, g.id, `  ${will.email.toUpperCase()} `).expect(201);
    const inv = Invite.parse(res.body);
    expect(inv).toMatchObject({ email: will.email, status: "pending", invitedBy: { id: owner.id }, respondedAt: null });

    expect((await api().get("/api/me/invites").set(other.auth)).body).toEqual([]);
    expect((await accept(other, inv.id)).body.error.code).toBe("INVITE_NOT_FOUND");
    expect((await api().post(`/api/invites/${inv.id}/decline`).set(other.auth)).status).toBe(404);

    const mine = (await api().get("/api/me/invites").set(will.auth).expect(200)).body.map(MyInvite.parse);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: inv.id, group: { id: g.id, name: g.name, memberCount: 1 }, invitedBy: { id: owner.id } });

    const joined = Group.parse((await accept(will, inv.id).expect(200)).body);
    expect(joined).toMatchObject({ id: g.id, role: "member", memberCount: 2 });
    expect((await api().get("/api/me/invites").set(will.auth)).body).toEqual([]);
    expect((await accept(will, inv.id)).status).toBe(404); // not pending anymore
    await api().get(`/api/groups/${g.id}`).set(will.auth).expect(200);
  });

  it("same response for emails with and without an account", async () => {
    const owner = await makeUser();
    const known = await makeUser();
    const g = await newGroup(owner);
    const a = await invite(owner, g.id, known.email);
    const b = await invite(owner, g.id, `nobody-${randomUUID()}@example.com`);
    expect(a.status).toBe(b.status);
    const strip = ({ id, email, createdAt, ...rest }: Invite) => rest;
    expect(strip(a.body)).toEqual(strip(b.body));
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
  });

  it("re-inviting reuses the row; ?status=all shows history", async () => {
    const owner = await makeUser();
    const g = await newGroup(owner);
    const email = `again-${randomUUID()}@example.com`;
    const first = Invite.parse((await invite(owner, g.id, email)).body);
    const second = Invite.parse((await invite(owner, g.id, email.toUpperCase())).body);
    expect(second.id).toBe(first.id);
    expect(await prisma.groupInvite.count({ where: { groupId: g.id } })).toBe(1);

    await api().delete(`/api/groups/${g.id}/invites/${first.id}`).set(owner.auth).expect(204);
    expect((await api().get(`/api/groups/${g.id}/invites`).set(owner.auth)).body).toEqual([]);
    const all = (await api().get(`/api/groups/${g.id}/invites?status=all`).set(owner.auth)).body;
    expect(all).toMatchObject([{ id: first.id, status: "revoked" }]);

    const third = Invite.parse((await invite(owner, g.id, email)).body);
    expect(third).toMatchObject({ id: first.id, status: "pending", respondedAt: null });
  });

  it("validates email and rejects existing members", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await groupWith(owner, member);
    expect((await invite(owner, g.id, "not-an-email")).status).toBe(400);
    expect((await invite(owner, g.id, member.email.toUpperCase())).body.error.code).toBe("ALREADY_MEMBER");
    expect((await invite(owner, g.id, owner.email)).status).toBe(409);
  });

  it("revoke: owner or inviter only, pending only; a revoked invite can't be accepted", async () => {
    const owner = await makeUser();
    const m1 = await makeUser();
    const m2 = await makeUser();
    const target = await makeUser();
    const g = await groupWith(owner, m1, m2);

    const inv = Invite.parse((await invite(m1, g.id, target.email)).body);
    expect((await api().get(`/api/groups/${g.id}/invites`).set(m2.auth)).body).toMatchObject([{ id: inv.id, invitedBy: { id: m1.id } }]);
    expect((await api().delete(`/api/groups/${g.id}/invites/${inv.id}`).set(m2.auth)).status).toBe(403);
    await api().delete(`/api/groups/${g.id}/invites/${inv.id}`).set(m1.auth).expect(204);
    expect((await api().delete(`/api/groups/${g.id}/invites/${inv.id}`).set(owner.auth)).body.error.code).toBe("INVITE_NOT_PENDING");
    expect((await accept(target, inv.id)).status).toBe(404);

    // Owner can revoke anyone's invite. Invite ids from another group are 404.
    const inv2 = Invite.parse((await invite(m1, g.id, `z-${randomUUID()}@example.com`)).body);
    const otherGroup = await newGroup(owner);
    expect((await api().delete(`/api/groups/${otherGroup.id}/invites/${inv2.id}`).set(owner.auth)).status).toBe(404);
    await api().delete(`/api/groups/${g.id}/invites/${inv2.id}`).set(owner.auth).expect(204);
  });

  it("decline marks the invite declined", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const g = await newGroup(owner);
    const inv = Invite.parse((await invite(owner, g.id, u.email)).body);
    await api().post(`/api/invites/${inv.id}/decline`).set(u.auth).expect(204);
    expect((await prisma.groupInvite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("declined");
    expect((await accept(u, inv.id)).status).toBe(404);
  });

  it("rate-limits invites to 20 per hour per user", async () => {
    const owner = await makeUser();
    const g = await newGroup(owner);
    for (let i = 0; i < 20; i++) await invite(owner, g.id, `rl-${i}-${randomUUID()}@example.com`).expect(201);
    const res = await invite(owner, g.id, `rl-x-${randomUUID()}@example.com`);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("leaving and removing members", () => {
  it("owner removes a member: membership gone, their invite revoked and not reusable", async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const g = await groupWith(owner, m);
    expect((await api().delete(`/api/groups/${g.id}/members/${owner.id}`).set(m.auth)).status).toBe(403);
    expect((await api().delete(`/api/groups/${g.id}/members/${owner.id}`).set(owner.auth)).status).toBe(400);

    await api().delete(`/api/groups/${g.id}/members/${m.id}`).set(owner.auth).expect(204);
    expect((await api().get(`/api/groups/${g.id}`).set(m.auth)).status).toBe(404);
    const row = await prisma.groupInvite.findUniqueOrThrow({ where: { groupId_email: { groupId: g.id, email: m.email } } });
    expect(row.status).toBe("revoked");
    expect((await accept(m, row.id)).status).toBe(404);
    expect((await api().delete(`/api/groups/${g.id}/members/${m.id}`).set(owner.auth)).status).toBe(404);

    // Re-inviting is a deliberate new action and works.
    await invite(owner, g.id, m.email).expect(201);
    await accept(m, row.id).expect(200);
  });

  it("last owner leaving promotes the longest-standing member; last member leaving deletes the group", async () => {
    const owner = await makeUser();
    const first = await makeUser();
    const second = await makeUser();
    const g = await groupWith(owner, first, second);

    await api().post(`/api/groups/${g.id}/leave`).set(owner.auth).expect(204);
    const roles = await prisma.groupMember.findMany({ where: { groupId: g.id }, select: { userId: true, role: true } });
    expect(roles).toHaveLength(2);
    expect(roles.find((r) => r.userId === first.id)?.role).toBe("owner");
    expect(roles.find((r) => r.userId === second.id)?.role).toBe("member");

    await api().post(`/api/groups/${g.id}/leave`).set(second.auth).expect(204);
    await api().post(`/api/groups/${g.id}/leave`).set(first.auth).expect(204);
    expect(await prisma.group.count({ where: { id: g.id } })).toBe(0);
  });

  it("DELETE /me hands ownership over and deletes groups left empty", async () => {
    const owner = await makeUser();
    const m = await makeUser();
    const shared = await groupWith(owner, m);
    const solo = await newGroup(owner);

    await api().delete("/api/me").set(owner.auth).expect(200);
    expect(await prisma.groupMember.findMany({ where: { groupId: shared.id }, select: { userId: true, role: true } })).toEqual([
      { userId: m.id, role: "owner" },
    ]);
    expect(await prisma.group.count({ where: { id: solo.id } })).toBe(0);
  });
});
