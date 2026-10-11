import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { google } from "../src/lib/google.js";
import { api, makeGroupDirect, makeUser, SEED_USERS, tokenFor } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("02 auth", () => {
  it("POST /auth/google creates a new user and returns {token, user}", async () => {
    const sub = `g-${randomUUID()}`;
    const spy = vi.spyOn(google, "verifyIdToken").mockResolvedValue({
      sub, email: "  New.Person@Example.com ", emailVerified: true, name: "New Person", picture: "https://pic/1",
    });
    const res = await api().post("/api/auth/google").send({ idToken: "good-token" });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("good-token");
    expect(res.body.user).toMatchObject({ email: "new.person@example.com", displayName: "New Person", avatarUrl: "https://pic/1" });
    expect(typeof res.body.token).toBe("string");
    const decoded = jwt.decode(res.body.token) as jwt.JwtPayload;
    expect(decoded.sub).toBe(res.body.user.id);
    expect(decoded.exp! - decoded.iat!).toBe(7 * 24 * 3600);

    const me = await api().get("/api/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.user.id);
  });

  it("a returning user is updated, not duplicated (one row per Google account)", async () => {
    const sub = `g-${randomUUID()}`;
    const spy = vi.spyOn(google, "verifyIdToken");
    spy.mockResolvedValueOnce({ sub, email: `a-${sub}@example.com`, emailVerified: true, name: "First", picture: "p1" });
    const first = await api().post("/api/auth/google").send({ idToken: "t1" });
    spy.mockResolvedValueOnce({ sub, email: `b-${sub}@example.com`, emailVerified: true, name: "Changed", picture: "p2" });
    const second = await api().post("/api/auth/google").send({ idToken: "t2" });
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.email).toBe(`b-${sub}@example.com`);
    expect(second.body.user.avatarUrl).toBe("p2");
    expect(await prisma.user.count({ where: { googleSub: sub } })).toBe(1);
  });

  it("a bad Google token returns 401", async () => {
    vi.spyOn(google, "verifyIdToken").mockRejectedValue(new Error("Wrong recipient"));
    const res = await api().post("/api/auth/google").send({ idToken: "bad" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("an unverified Google email returns 401 and creates no user", async () => {
    const sub = `g-${randomUUID()}`;
    vi.spyOn(google, "verifyIdToken").mockResolvedValue({ sub, email: "x@example.com", emailVerified: false });
    const res = await api().post("/api/auth/google").send({ idToken: "t" });
    expect(res.status).toBe(401);
    expect(await prisma.user.count({ where: { googleSub: sub } })).toBe(0);
  });

  it("missing idToken returns 400 VALIDATION_ERROR", async () => {
    const res = await api().post("/api/auth/google").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["GET", "/api/me"],
    ["PATCH", "/api/me"],
    ["DELETE", "/api/me"],
    ["GET", "/api/groups"],
    ["GET", `/api/groups/${randomUUID()}/shopping-list`],
    ["GET", "/api/items/search?q=milk"],
  ])("%s %s without a valid JWT returns 401", async (method, path) => {
    const r1 = await api()[method.toLowerCase() as "get"](path);
    expect(r1.status).toBe(401);
    expect(r1.body.error.code).toBe("UNAUTHENTICATED");
    const r2 = await api()[method.toLowerCase() as "get"](path).set("Authorization", "Bearer not-a-jwt");
    expect(r2.status).toBe(401);
    const forged = jwt.sign({}, "some-other-secret-of-length", { subject: SEED_USERS[0] });
    const r3 = await api()[method.toLowerCase() as "get"](path).set("Authorization", `Bearer ${forged}`);
    expect(r3.status).toBe(401);
  });

  it("PATCH /me updates displayName and zipCode; invalid zip is 400", async () => {
    const u = await makeUser();
    const res = await api().patch("/api/me").set(u.auth).send({ displayName: "Carson", zipCode: "64105" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: "Carson", zipCode: "64105" });
    const bad = await api().patch("/api/me").set(u.auth).send({ zipCode: "abc" });
    expect(bad.status).toBe(400);
  });

  it("DELETE /me deletes the user, hands ownership over, and the old token stops working", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const solo = await makeUser();
    const shared = await makeGroupDirect(owner, [member]);
    const alone = await makeGroupDirect(owner);
    const soloGroup = await makeGroupDirect(solo);
    expect(soloGroup.id).toBeTruthy();

    const res = await api().delete("/api/me").set(owner.auth);
    expect(res.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: owner.id } })).toBeNull();
    const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: shared.id, userId: member.id } } });
    expect(m?.role).toBe("owner");
    expect(await prisma.group.findUnique({ where: { id: alone.id } })).toBeNull();
    expect((await api().get("/api/me").set(owner.auth)).status).toBe(401);
  });

  it("dev login-as returns a session for a seeded user", async () => {
    const res = await api().post(`/api/dev/login-as/${SEED_USERS[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(SEED_USERS[0]);
    const me = await api().get("/api/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.body.displayName).toBe("User 1");
    expect((await api().post(`/api/dev/login-as/${randomUUID()}`)).status).toBe(404);
    expect(tokenFor(SEED_USERS[1]).Authorization).toMatch(/^Bearer /);
  });
});
