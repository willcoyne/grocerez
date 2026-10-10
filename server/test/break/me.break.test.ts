// Break tests (M1): app JWTs, /me input validation, races, dev login. Local Postgres only; Google is stubbed.
// Tests named "[DEFECT B-xx]" are expected to FAIL until the defect is fixed (see test-reports/backend.md).
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/db.js";
import { verifyGoogleIdToken } from "../../src/lib/google.js";
import { signAppToken } from "../../src/middleware/auth.js";

vi.mock("../../src/lib/google.js", () => ({ verifyGoogleIdToken: vi.fn() }));
const verify = vi.mocked(verifyGoogleIdToken);
const SECRET = process.env.JWT_SECRET!;

const subs: string[] = [];
async function makeUser() {
  const sub = `break-me-${randomUUID()}`;
  subs.push(sub);
  const user = await prisma.user.create({ data: { googleSub: sub, email: `${sub}@example.com`, displayName: "Breaker" } });
  return { user, sub, token: signAppToken(user.id) };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const isStdError = (body: unknown) =>
  expect(body).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { googleSub: { in: subs } } });
  await prisma.$disconnect();
});

describe("app JWT edge cases", () => {
  it.each([
    ["HS512 with the right secret", (id: string) => jwt.sign({ sub: id }, SECRET, { algorithm: "HS512" })],
    ["not yet valid (nbf in future)", (id: string) => jwt.sign({ sub: id, nbf: Math.floor(Date.now() / 1000) + 3600 }, SECRET)],
    ["sub as array", (id: string) => jwt.sign({ sub: [id] } as object, SECRET)],
    ["sub missing", (_id: string) => jwt.sign({ uid: "x" }, SECRET)],
    ["payload tampered (re-encoded with another sub, old sig)", (id: string) => {
      const [h, , s] = jwt.sign({ sub: id }, SECRET).split(".");
      return `${h}.${Buffer.from(JSON.stringify({ sub: randomUUID() })).toString("base64url")}.${s}`;
    }],
  ])("%s -> 401", async (_n, make) => {
    const { user } = await makeUser();
    const res = await request(app).get("/api/me").set(bearer(make(user.id)));
    expect(res.status).toBe(401);
    isStdError(res.body);
  });

  it("token of a deleted user stops working on every method", async () => {
    const { user, token } = await makeUser();
    await prisma.user.delete({ where: { id: user.id } });
    for (const m of ["get", "patch", "delete"] as const) {
      const res = await request(app)[m]("/api/me").set(bearer(token)).send({ displayName: "x" });
      expect(res.status, m).toBe(401);
    }
  });
});

describe("PATCH /me input validation", () => {
  it.each([
    [{ displayName: 5 }], [{ displayName: null }], [{ displayName: "x".repeat(81) }], [{ zipCode: 63130 }],
    [{ zipCode: "6313" }], [{ zipCode: "' OR 1=1 --" }], [{ displayName: "ok", isAdmin: true }],
    [[]],
  ])("%j -> 400 standard shape", async (body) => {
    const { token } = await makeUser();
    const res = await request(app).patch("/api/me").set(bearer(token)).send(body as object);
    expect(res.status).toBe(400);
    isStdError(res.body);
  });

  it("[DEFECT B-04] displayName containing a NUL byte -> 400, not 500", async () => {
    const { token } = await makeUser();
    const res = await request(app).patch("/api/me").set(bearer(token)).send({ displayName: "Bob\u0000by" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("[DEFECT B-09] displayName made only of invisible characters is rejected", async () => {
    const { token } = await makeUser();
    for (const name of ["​", "​‌‍", "⁠", "‮"]) {
      const res = await request(app).patch("/api/me").set(bearer(token)).send({ displayName: name });
      expect(res.status, JSON.stringify(name)).toBe(400);
    }
  });

  it("unicode names and SQL-looking strings are stored verbatim (parameterized)", async () => {
    const { token } = await makeUser();
    for (const name of ["Zoë 李 🍎", "Robert'); DROP TABLE users;--"]) {
      const res = await request(app).patch("/api/me").set(bearer(token)).send({ displayName: name });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe(name);
    }
  });
});

describe("races on /me", () => {
  it("[DEFECT B-05] two concurrent DELETE /me: one 200, the other 401/404, never 500", async () => {
    const { token } = await makeUser();
    const results = await Promise.all([1, 2, 3].map(() => request(app).delete("/api/me").set(bearer(token))));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses).not.toContain(500);
  });

  it("[DEFECT B-05] PATCH racing a DELETE never returns 500", async () => {
    const { token } = await makeUser();
    const results = await Promise.all([
      request(app).delete("/api/me").set(bearer(token)),
      ...[1, 2, 3].map(() => request(app).patch("/api/me").set(bearer(token)).send({ displayName: "late" })),
    ]);
    expect(results.map((r) => r.status)).not.toContain(500);
  });
});

describe("Google login email collisions", () => {
  it("[DEFECT B-08] a Google account whose email is held by a stale row can still sign in", async () => {
    // Stale row: an old account that used to own this address (Workspace address reassigned, or Google email changed).
    const { user: stale } = await makeUser();
    const sub = `break-me-${randomUUID()}`;
    subs.push(sub);
    verify.mockResolvedValueOnce({ sub, email: stale.email.toUpperCase(), emailVerified: true, name: "New Owner" });
    const res = await request(app).post("/api/auth/google").send({ idToken: "t" });
    expect(res.status).toBe(200); // actual: 409 CONFLICT, user is locked out with no way to recover
  });
});

describe("dev login-as", () => {
  it("[DEFECT B-07] only seeded demo users can be impersonated (plan 02 step 6)", async () => {
    // A real Google-created user (not seeded) must not be reachable through the dev backdoor.
    const { user } = await makeUser();
    const res = await request(app).post(`/api/dev/login-as/${user.id}`);
    expect(res.status).not.toBe(200);
  });

  it("is unreachable with NODE_ENV=production, even with a valid token", async () => {
    const { user, token } = await makeUser();
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { app: prodApp } = await import("../../src/app.js");
      expect((await request(prodApp).post(`/api/dev/login-as/${user.id}`)).status).toBe(401);
      const authed = await request(prodApp).post(`/api/dev/login-as/${user.id}`).set(bearer(token));
      expect(authed.status).toBe(404);
      expect(authed.body.token).toBeUndefined();
      await (await import("../../src/db.js")).prisma.$disconnect();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("error shape", () => {
  it("malformed JSON, oversize body, and unknown routes all use {error:{code,message}} with no stack", async () => {
    const { token } = await makeUser();
    const bad = await request(app).patch("/api/me").set(bearer(token)).set("Content-Type", "application/json").send("{\"displayName\":");
    const big = await request(app).patch("/api/me").set(bearer(token)).send({ displayName: "x".repeat(1_100_000) });
    const nf = await request(app).get("/api/does-not-exist").set(bearer(token));
    for (const [r, s] of [[bad, 400], [big, 413], [nf, 404]] as const) {
      expect(r.status).toBe(s);
      isStdError(r.body);
      expect(JSON.stringify(r.body)).not.toMatch(/node_modules|\.ts:\d+|at /);
    }
  });
});
