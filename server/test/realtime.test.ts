import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { Group, Invite } from "../src/contracts/groups.js";
import { prisma } from "../src/db.js";
import { attachRealtime, emitGroup } from "../src/lib/realtime.js";
import { cleanupUsers, makeUser } from "./helpers.js";

type U = Awaited<ReturnType<typeof makeUser>>;
const server = createServer(app);
let url = "";
const sockets: Socket[] = [];

beforeAll(async () => {
  attachRealtime(server, []);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await new Promise((r) => server.close(r));
  await cleanupUsers();
  await prisma.$disconnect();
});

function open(token: string): Promise<Socket> {
  const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
const join = (s: Socket, groupId: unknown) => s.emitWithAck("group:join", { groupId }) as Promise<{ ok: boolean }>;
const next = (s: Socket, event: string, ms = 1000) =>
  new Promise<unknown>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    s.once(event, (p) => (clearTimeout(t), resolve(p)));
  });
// Resolves true if `event` arrives within ms.
const receives = (s: Socket, event: string, ms = 300) => next(s, event, ms).then(() => true, () => false);

async function setup() {
  const owner = await makeUser();
  const member = await makeUser();
  const g = Group.parse((await request(app).post("/api/groups").set(owner.auth).send({ name: "Room" })).body);
  const inv = Invite.parse((await request(app).post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: member.email })).body);
  await request(app).post(`/api/invites/${inv.id}/accept`).set(member.auth).expect(200);
  return { owner, member, g };
}

describe("socket auth", () => {
  it("rejects missing and invalid tokens", async () => {
    await expect(open("")).rejects.toThrow("UNAUTHENTICATED");
    await expect(open("garbage")).rejects.toThrow("UNAUTHENTICATED");
  });
});

describe("group rooms", () => {
  it("members get group events in under a second; outsiders can't join", async () => {
    const { owner, member, g } = await setup();
    const outsider: U = await makeUser();
    const [a, b, c] = await Promise.all([open(owner.token), open(member.token), open(outsider.token)]);

    expect(await join(a, g.id)).toEqual({ ok: true });
    expect(await join(b, g.id)).toEqual({ ok: true });
    expect(await join(c, g.id)).toEqual({ ok: false });
    expect(await join(c, "not-a-uuid")).toEqual({ ok: false });

    const started = Date.now();
    const got = next(b, "shopping-list:changed");
    const leak = receives(c, "shopping-list:changed");
    emitGroup(g.id, "shopping-list:changed", owner.id);
    expect(await got).toEqual({ groupId: g.id, by: owner.id });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await leak).toBe(false);

    // REST mutations emit group:changed to the room.
    const changed = next(b, "group:changed");
    await request(app).patch(`/api/groups/${g.id}`).set(owner.auth).send({ name: "Renamed" }).expect(200);
    expect(await changed).toEqual({ groupId: g.id, by: owner.id });

    // group:leave stops events.
    await b.emitWithAck("group:leave", { groupId: g.id });
    const afterLeave = receives(b, "cabinet:changed");
    emitGroup(g.id, "cabinet:changed", owner.id);
    expect(await afterLeave).toBe(false);
  });

  it("a removed member is kicked from the room", async () => {
    const { owner, member, g } = await setup();
    const s = await open(member.token);
    expect(await join(s, g.id)).toEqual({ ok: true });

    const told = next(s, "group:changed"); // via their personal room
    await request(app).delete(`/api/groups/${g.id}/members/${member.id}`).set(owner.auth).expect(204);
    expect(await told).toEqual({ groupId: g.id, by: owner.id });

    const leak = receives(s, "shopping-list:changed");
    emitGroup(g.id, "shopping-list:changed", owner.id);
    expect(await leak).toBe(false);
    expect(await join(s, g.id)).toEqual({ ok: false });
  });
});

describe("personal room", () => {
  it("invites:changed reaches only the invited user", async () => {
    const owner = await makeUser();
    const invitee = await makeUser();
    const bystander = await makeUser();
    const g = Group.parse((await request(app).post("/api/groups").set(owner.auth).send({ name: "Home" })).body);
    const [si, sb] = await Promise.all([open(invitee.token), open(bystander.token)]);

    const got = next(si, "invites:changed");
    const leak = receives(sb, "invites:changed");
    await request(app).post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: invitee.email }).expect(201);
    await got;
    expect(await leak).toBe(false);
  });
});
