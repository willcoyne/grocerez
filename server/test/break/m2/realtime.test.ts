import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachRealtime } from "../../../src/lib/realtime.js";
import { signAppToken } from "../../../src/middleware/auth.js";
import { addMember, api, app, cleanup, join, makeUser, mkGroup, mkItem, prisma, type U } from "./helpers.js";

// Attack #8: Socket.IO rooms (backend/07).
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
  await cleanup();
});

function open(token: unknown): Promise<Socket> {
  const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
const joinRoom = (s: Socket, groupId: unknown) => s.timeout(2000).emitWithAck("group:join", { groupId }) as Promise<{ ok: boolean }>;
// Collects every event a socket receives.
const record = (s: Socket) => {
  const got: string[] = [];
  s.onAny((e, p) => got.push(`${e}:${p?.groupId ?? ""}`));
  return got;
};
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("handshake", () => {
  it("rejects no token, non-string tokens, garbage, wrong signature, alg:none, expired, and deleted-user tokens", async () => {
    const u = await makeUser();
    const gone = await makeUser();
    const goneToken = gone.token;
    await prisma.user.delete({ where: { id: gone.id } });
    const bad: unknown[] = [
      undefined, "", 123, { sub: u.id }, ["x"], "garbage",
      jwt.sign({ sub: u.id }, "wrong-secret-wrong-secret-wrong-secret"),
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: u.id })).toString("base64url")}.`,
      jwt.sign({ sub: u.id, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET!),
      jwt.sign({ sub: "' OR 1=1 --" }, process.env.JWT_SECRET!),
      goneToken,
    ];
    for (const t of bad) await expect(open(t), String(t).slice(0, 30)).rejects.toThrow("UNAUTHENTICATED");
    await expect(open(signAppToken(u.id))).resolves.toBeTruthy();
  });
});

describe("rooms", () => {
  let A: U, A2: U, B: U, g1: { id: string }, g2: { id: string };
  beforeAll(async () => {
    [A, A2, B] = [await makeUser(), await makeUser(), await makeUser()];
    g1 = await mkGroup(A, "RT1");
    g2 = await mkGroup(B, "RT2");
    await addMember(g1.id, A2);
  });

  it("a foreign user can't join another group's room by any spelling of its id", async () => {
    const s = await open(B.token);
    for (const id of [g1.id, g1.id.toUpperCase(), ` ${g1.id}`, `{${g1.id}}`, g1.id.replace(/-/g, ""), [g1.id], { $ne: null }, null]) {
      expect((await joinRoom(s, id)).ok, JSON.stringify(id)).toBe(false);
    }
    // Malformed payloads don't crash the server or disconnect the socket.
    s.emit("group:join", "not-an-object");
    s.emit("group:join");
    s.emit("group:join", { groupId: g1.id }, "not-a-function");
    await settle();
    expect(s.connected).toBe(true);
    expect((await joinRoom(s, g2.id)).ok).toBe(true);
  });

  it("REST writes in group 1 reach only group 1 sockets (not group 2, not a foreign socket)", async () => {
    const [sa2, sb] = [await open(A2.token), await open(B.token)];
    await joinRoom(sa2, g1.id);
    await joinRoom(sb, g2.id);
    await joinRoom(sb, g1.id); // denied
    const ga2 = record(sa2), gb = record(sb);
    const it = await mkItem("RTItem");
    await api().post(`/api/groups/${g1.id}/preferences`).set(A.auth).send({ itemId: it.id }).expect(200);
    await api().post(`/api/groups/${g1.id}/cabinet`).set(A.auth).send({ itemId: it.id }).expect(200);
    await settle();
    expect(ga2).toEqual(expect.arrayContaining([`preferences:changed:${g1.id}`, `cabinet:changed:${g1.id}`, `shopping-list:changed:${g1.id}`]));
    expect(gb).toEqual([]);
  });

  it("removed, leaving, and deleted members stop receiving group events", async () => {
    const g = await mkGroup(A, "Kick");
    const [r1, r2, r3] = [await makeUser(), await makeUser(), await makeUser()];
    for (const u of [r1, r2, r3]) await addMember(g.id, u);
    const ss = await Promise.all([r1, r2, r3].map((u) => open(u.token)));
    for (const s of ss) expect((await joinRoom(s, g.id)).ok).toBe(true);
    const logs = ss.map(record);
    await api().delete(`/api/groups/${g.id}/members/${r1.id}`).set(A.auth).expect(204);
    await api().post(`/api/groups/${g.id}/leave`).set(r2.auth).expect(204);
    await api().delete("/api/me").set(r3.auth).expect(200);
    await settle();
    logs.forEach((l) => (l.length = 0));
    const it = await mkItem("KickItem");
    await api().post(`/api/groups/${g.id}/shopping-list`).set(A.auth).send({ itemId: it.id }).expect(200);
    await settle();
    expect(logs).toEqual([[], [], []]);
    for (const s of ss.slice(0, 2)) expect((await joinRoom(s, g.id)).ok).toBe(false);
  });

  it("invites:changed goes only to the invitee's personal room", async () => {
    const [owner, invitee, other] = [await makeUser(), await makeUser(), await makeUser()];
    const g = await mkGroup(owner, "Inv");
    const [si, so] = [await open(invitee.token), await open(other.token)];
    const [li, lo] = [record(si), record(so)];
    await api().post(`/api/groups/${g.id}/invites`).set(owner.auth).send({ email: invitee.email }).expect(201);
    await settle();
    expect(li.some((e) => e.startsWith("invites:changed"))).toBe(true);
    expect(lo).toEqual([]);
  });

  it("[DEFECT M2-06] a REST call using an upper-case group id emits to a different room, so members miss the update", async () => {
    const g = await mkGroup(A, "Case");
    await addMember(g.id, A2);
    const s = await open(A2.token);
    expect((await joinRoom(s, g.id)).ok).toBe(true);
    const log = record(s);
    const it = await mkItem("CaseItem");
    // requireGroupMember accepts any-case UUIDs (Postgres compares uuids case-insensitively), but room names are raw strings.
    await api().post(`/api/groups/${g.id.toUpperCase()}/shopping-list`).set(A.auth).send({ itemId: it.id }).expect(200);
    await settle();
    expect(log).toContain(`shopping-list:changed:${g.id}`);
  });

  it("[DEFECT M2-06] a member who joined with an upper-case id keeps receiving events after being removed", async () => {
    const g = await mkGroup(A, "Case2");
    const ex = await makeUser();
    await join(A, g.id, ex);
    const s = await open(ex.token);
    expect((await joinRoom(s, g.id.toUpperCase())).ok).toBe(true); // joins room "group:<UPPER>"
    await api().delete(`/api/groups/${g.id}/members/${ex.id}`).set(A.auth).expect(204); // kicks only "group:<lower>"
    await settle();
    const log = record(s);
    const it = await mkItem("Case2Item");
    await api().post(`/api/groups/${g.id.toUpperCase()}/cabinet`).set(A.auth).send({ itemId: it.id }).expect(200);
    await settle();
    expect(log, "ex-member still in the group's (upper-case) room").toEqual([]);
  });
});
