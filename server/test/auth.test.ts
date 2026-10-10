import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { AuthResponse, User } from "../src/contracts/auth.js";
import { prisma } from "../src/db.js";
import { verifyGoogleIdToken, type GoogleIdentity } from "../src/lib/google.js";

vi.mock("../src/lib/google.js", () => ({ verifyGoogleIdToken: vi.fn() }));
const verify = vi.mocked(verifyGoogleIdToken);

const subs: string[] = [];
const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => {
  const sub = `test-${randomUUID()}`;
  subs.push(sub);
  return { sub, email: `${sub}@Example.com`, emailVerified: true, name: "Ada Lovelace", picture: "https://pic/a.png", ...over };
};
const login = (g: GoogleIdentity) => {
  verify.mockResolvedValueOnce(g);
  return request(app).post("/api/auth/google").send({ idToken: "google-token" });
};
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => verify.mockReset());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { googleSub: { in: subs } } });
  await prisma.$disconnect();
});

describe("POST /api/auth/google", () => {
  it("creates a new user and returns a working 7-day HS256 token", async () => {
    const g = identity();
    const res = await login(g);
    expect(res.status).toBe(200);
    const body = AuthResponse.parse(res.body);
    expect(verify).toHaveBeenCalledWith("google-token");
    expect(body.user).toMatchObject({ email: g.email.toLowerCase(), displayName: "Ada Lovelace", avatarUrl: g.picture, zipCode: null });
    expect(res.body.user.googleSub).toBeUndefined();

    const decoded = jwt.decode(body.token, { complete: true })!;
    expect(decoded.header.alg).toBe("HS256");
    const p = decoded.payload as jwt.JwtPayload;
    expect(p.sub).toBe(body.user.id);
    expect(p.exp! - p.iat!).toBe(7 * 24 * 3600);

    const me = await request(app).get("/api/me").set(bearer(body.token));
    expect(me.status).toBe(200);
    expect(me.body).toEqual(body.user);
  });

  it("returning user is updated, not duplicated (keyed on google_sub)", async () => {
    const g = identity();
    const first = AuthResponse.parse((await login(g)).body);
    await request(app).patch("/api/me").set(bearer(first.token)).send({ displayName: "Edited" });

    const second = await login({ ...g, email: `new-${g.sub}@example.com`, name: "Google Name" });
    expect(second.status).toBe(200);
    expect(second.body.user).toMatchObject({ id: first.user.id, email: `new-${g.sub}@example.com`, displayName: "Edited" });
    expect(await prisma.user.count({ where: { googleSub: g.sub } })).toBe(1);
  });

  it("bad Google token returns 401 and creates nothing", async () => {
    verify.mockRejectedValueOnce(new Error("Wrong recipient"));
    const res = await request(app).post("/api/auth/google").send({ idToken: "forged" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("unverified email returns 401 and creates nothing", async () => {
    const g = identity({ emailVerified: false });
    const res = await login(g);
    expect(res.status).toBe(401);
    expect(await prisma.user.count({ where: { googleSub: g.sub } })).toBe(0);
  });

  it("missing idToken returns 400", async () => {
    const res = await request(app).post("/api/auth/google").send({});
    expect(res.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("requireAuth", () => {
  it.each([
    ["no header", undefined],
    ["wrong scheme", "Basic abc"],
    ["garbage token", "Bearer abc"],
    ["wrong secret", `Bearer ${jwt.sign({ sub: randomUUID() }, "x".repeat(40))}`],
    ["expired", `Bearer ${jwt.sign({ sub: randomUUID(), exp: 1 }, process.env.JWT_SECRET!)}`],
    ["alg none", `Bearer ${jwt.sign({ sub: randomUUID() }, "", { algorithm: "none" })}`],
    ["unknown user", `Bearer ${jwt.sign({ sub: randomUUID() }, process.env.JWT_SECRET!)}`],
    ["non-uuid sub", `Bearer ${jwt.sign({ sub: "abc" }, process.env.JWT_SECRET!)}`],
  ])("%s returns 401 UNAUTHENTICATED", async (_name, header) => {
    for (const [method, path] of [["get", "/api/me"], ["patch", "/api/me"], ["delete", "/api/me"], ["get", "/api/anything"]] as const) {
      const req = request(app)[method](path);
      const res = await (header ? req.set("Authorization", header) : req);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("health stays public; unknown routes are 404 once authenticated", async () => {
    expect((await request(app).get("/api/health")).status).toBe(200);
    const { token } = AuthResponse.parse((await login(identity())).body);
    expect((await request(app).get("/api/nope").set(bearer(token))).status).toBe(404);
  });
});

describe("/api/me", () => {
  it("PATCH updates displayName and zipCode, validates, and can clear zipCode", async () => {
    const { token } = AuthResponse.parse((await login(identity())).body);
    const ok = await request(app).patch("/api/me").set(bearer(token)).send({ displayName: "  Bob ", zipCode: "63130" });
    expect(ok.status).toBe(200);
    expect(User.parse(ok.body)).toMatchObject({ displayName: "Bob", zipCode: "63130" });

    for (const bad of [{ zipCode: "abc" }, { displayName: "" }, { email: "x@y.z" }]) {
      expect((await request(app).patch("/api/me").set(bearer(token)).send(bad)).status).toBe(400);
    }
    const cleared = await request(app).patch("/api/me").set(bearer(token)).send({ zipCode: null });
    expect(cleared.body.zipCode).toBeNull();
  });

  it("DELETE removes the user, cascades diets/allergens, and kills the token", async () => {
    const { token, user } = AuthResponse.parse((await login(identity())).body);
    await prisma.userDiet.create({ data: { userId: user.id, diet: "vegan" } });
    await prisma.userAllergen.create({ data: { userId: user.id, allergen: "peanuts" } });

    const res = await request(app).delete("/api/me").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(user);
    expect(await prisma.userDiet.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.userAllergen.count({ where: { userId: user.id } })).toBe(0);
    expect((await request(app).get("/api/me").set(bearer(token))).status).toBe(401);
  });
});

describe("schema (database/02-users)", () => {
  it("duplicate google_sub fails; invalid diet fails", async () => {
    const g = identity();
    const { user } = AuthResponse.parse((await login(g)).body);
    await expect(
      prisma.user.create({ data: { googleSub: g.sub, email: `other-${g.sub}@x.com`, displayName: "x" } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.userDiet.create({ data: { userId: user.id, diet: "carnivore" } })).rejects.toThrow();
  });
});

describe("POST /api/dev/login-as/:userId", () => {
  it("returns a token for an existing user, 404 for unknown, 400 for non-uuid", async () => {
    const { user } = AuthResponse.parse((await login(identity())).body);
    const res = await request(app).post(`/api/dev/login-as/${user.id}`);
    expect(res.status).toBe(200);
    expect(AuthResponse.parse(res.body).user.id).toBe(user.id);
    expect((await request(app).post(`/api/dev/login-as/${randomUUID()}`)).status).toBe(404);
    expect((await request(app).post("/api/dev/login-as/nope")).status).toBe(400);
  });

  it("is not mounted in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { app: prodApp } = await import("../src/app.js");
      expect((await request(prodApp).post(`/api/dev/login-as/${randomUUID()}`)).status).toBe(401);
      await (await import("../src/db.js")).prisma.$disconnect();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// Last: exhausts this file's limiter.
describe("rate limit", () => {
  it("allows 20 sign-in attempts per minute per IP, then 429", async () => {
    verify.mockResolvedValue(identity());
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await request(app).post("/api/auth/google").send({ idToken: "x" })).status);
    // Earlier tests in this file already used some of the 20.
    expect(statuses).toContain(200);
    expect(statuses.at(-1)).toBe(429);
    const res = await request(app).post("/api/auth/google").send({ idToken: "x" });
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });
});
