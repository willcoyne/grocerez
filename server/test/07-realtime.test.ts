import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { setIo } from "../src/lib/realtime.js";
import { createSocketServer } from "../src/realtime/socket.js";
import { itemId, makeGroup, makeUser, type TestUser } from "./helpers.js";

let http: HttpServer;
let url: string;
const app = createApp();
const sockets: Socket[] = [];

beforeAll(async () => {
  http = createServer(app);
  createSocketServer(http);
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  setIo(null);
  await new Promise((r) => http.close(r));
});

function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(e));
  });
}

const join = (s: Socket, groupId: string) =>
  s.emitWithAck("group:join", { groupId }) as Promise<{ ok: boolean; error?: { code: string } }>;

function next<T = unknown>(s: Socket, event: string, ms = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}

function never(s: Socket, event: string, ms = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const h = () => reject(new Error(`unexpected ${event}`));
    s.once(event, h);
    setTimeout(() => {
      s.off(event, h);
      resolve();
    }, ms);
  });
}

const http_ = () => request(app);

describe("07 realtime", () => {
  let a: TestUser;
  let b: TestUser;
  let g: { id: string };

  beforeAll(async () => {
    a = await makeUser();
    b = await makeUser();
    g = await makeGroup(a, [b]);
  });

  it("rejects connections without a valid token", async () => {
    await expect(open("bad-token")).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it("checking an item on phone A updates phone B in under 1 second", async () => {
    const phoneB = await open(b.token);
    expect(await join(phoneB, g.id)).toEqual({ ok: true });
    await http_().post(`/api/groups/${g.id}/preferences`).set(a.auth).send({ itemId: await itemId("Milk") }).expect(201);
    const list = await http_().get(`/api/groups/${g.id}/shopping-list`).set(a.auth);

    const started = Date.now();
    const got = next<{ groupId: string; by: string }>(phoneB, "shopping-list:changed");
    await http_().patch(`/api/groups/${g.id}/shopping-list/${list.body[0].id}`).set(a.auth).send({ checked: true }).expect(200);
    expect(await got).toEqual({ groupId: g.id, by: a.id });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("cabinet, preference and group changes are signalled to the group room", async () => {
    const phoneB = await open(b.token);
    await join(phoneB, g.id);
    const cab = next(phoneB, "cabinet:changed");
    await http_().post(`/api/groups/${g.id}/cabinet`).set(a.auth).send({ itemId: await itemId("Eggs") }).expect(201);
    expect(await cab).toEqual({ groupId: g.id, by: a.id });

    const pref = next(phoneB, "preferences:changed");
    await http_().post(`/api/groups/${g.id}/preferences`).set(a.auth).send({ itemId: await itemId("Bread") }).expect(201);
    expect(await pref).toEqual({ groupId: g.id, by: a.id });

    const grp = next(phoneB, "group:changed");
    await http_().patch(`/api/groups/${g.id}`).set(a.auth).send({ name: "Renamed House" }).expect(200);
    expect(await grp).toEqual({ groupId: g.id, by: a.id });
  });

  it("a user who isn't in the group can't join its room or hear its events", async () => {
    const outsider = await makeUser();
    const s = await open(outsider.token);
    expect(await join(s, g.id)).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Group not found" } });
    expect((await join(s, "not-a-uuid")).ok).toBe(false);
    const silent = never(s, "preferences:changed");
    await http_().post(`/api/groups/${g.id}/preferences`).set(a.auth).send({ itemId: await itemId("Apples") }).expect(201);
    await silent;
  });

  it("inviting a user's email pings their personal room with invites:changed", async () => {
    const invitee = await makeUser();
    const s = await open(invitee.token);
    const ping = next<{ groupId: string }>(s, "invites:changed");
    await http_().post(`/api/groups/${g.id}/invites`).set(a.auth).send({ email: invitee.email }).expect(201);
    expect((await ping).groupId).toBe(g.id);
  });

  it("a removed member's sockets leave the group room", async () => {
    const c = await makeUser();
    const g2 = await makeGroup(a, [c]);
    const s = await open(c.token);
    expect(await join(s, g2.id)).toEqual({ ok: true });
    const kicked = next(s, "group:changed");
    await http_().delete(`/api/groups/${g2.id}/members/${c.id}`).set(a.auth).expect(204);
    await kicked; // personal-room notice
    const silent = never(s, "preferences:changed");
    await http_().post(`/api/groups/${g2.id}/preferences`).set(a.auth).send({ itemId: await itemId("Milk") }).expect(201);
    await silent;
  });
});
