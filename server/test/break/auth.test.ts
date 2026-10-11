/**
 * Attack 2: authentication. App JWT tampering, deleted accounts, Google ID tokens (verified by the REAL
 * google-auth-library code against a locally generated signing key: only the certificate download is stubbed), and the
 * dev login route in production.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { prisma } from "../../src/db.js";
import { api, expectErrorShape, guardNetwork, makeUser, SEED_USERS } from "./helpers.js";

const SECRET = "test-secret-test-secret-test-secret";
const WEB_CLIENT = "test-web-client.apps.googleusercontent.com";

beforeEach(() => {
  guardNetwork();
});
afterEach(() => vi.restoreAllMocks());

describe("attack 2: app JWT", () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

  it("missing / malformed Authorization header → 401 UNAUTHENTICATED on a protected route", async () => {
    for (const h of [undefined, "", "Bearer", "Bearer ", "Basic dXNlcjpwYXNz", "bearer x.y.z", "Token abc"]) {
      const t = api().get("/api/me");
      const res = await (h === undefined ? t : t.set("Authorization", h));
      expectErrorShape(res, 401, "UNAUTHENTICATED");
    }
  });

  it("expired, wrong-signature, alg:none and HS512 tokens are rejected", async () => {
    const u = await makeUser();
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, SECRET, { algorithm: "HS256", subject: u.id });
    const wrongSig = jwt.sign({}, "some-other-secret-some-other-secret", { algorithm: "HS256", subject: u.id });
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    const noneUpper = `${b64({ alg: "NONE", typ: "JWT" })}.${b64({ sub: u.id })}.`;
    const hs512 = jwt.sign({}, SECRET, { algorithm: "HS512", subject: u.id });
    const [h, p] = u.token.split(".");
    const tamperedPayload = `${h}.${b64({ sub: SEED_USERS[0], exp: Math.floor(Date.now() / 1000) + 3600 })}.${u.token.split(".")[2]}`;
    for (const tok of [expired, wrongSig, none, noneUpper, hs512, tamperedPayload, `${h}.${p}.`]) {
      expectErrorShape(await api().get("/api/me").set("Authorization", `Bearer ${tok}`), 401, "UNAUTHENTICATED");
    }
  });

  it("a token for a deleted user stops working immediately (REST)", async () => {
    const u = await makeUser();
    await api().delete("/api/me").set(u.auth).expect(204);
    expectErrorShape(await api().get("/api/me").set(u.auth), 401, "UNAUTHENTICATED");
    expectErrorShape(await api().get("/api/groups").set(u.auth), 401, "UNAUTHENTICATED");
  });

  it("[API-AUTH-2] a validly signed token whose sub is not a UUID is a 401, not a 500", async () => {
    const tok = jwt.sign({}, SECRET, { algorithm: "HS256", subject: "not-a-uuid", expiresIn: "1h" });
    expectErrorShape(await api().get("/api/me").set("Authorization", `Bearer ${tok}`), 401, "UNAUTHENTICATED");
  });
});

describe("attack 2: Google ID token (real verifier, local signing key)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const KID = "break-test-kid";
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

  beforeEach(() => {
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
      certs: { [KID]: pem },
      format: "PEM",
    } as never);
  });

  const idToken = (over: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: "https://accounts.google.com", aud: WEB_CLIENT, sub: `g-${randomUUID()}`,
        email: `g-${randomUUID().slice(0, 8)}@example.com`, email_verified: true, name: "G User", iat: now - 10, exp: now + 3600,
        ...over,
      },
      privateKey,
      { algorithm: "RS256", keyid: KID },
    );
  };
  const signIn = (tok: string) => api().post("/api/auth/google").send({ idToken: tok });

  it("control: a valid token signs in and creates exactly one user", async () => {
    const sub = `g-${randomUUID()}`;
    const res = await signIn(idToken({ sub, email: "  Mixed.Case@Example.COM " }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.email).toBe("mixed.case@example.com");
    await signIn(idToken({ sub, email: "mixed.case@example.com" })).expect(200);
    expect(await prisma.user.count({ where: { googleSub: sub } })).toBe(1);
  });

  it("wrong audience, wrong issuer, expired, unsigned and foreign-key tokens → 401 UNAUTHENTICATED, no user row", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const now = Math.floor(Date.now() / 1000);
    const cases = {
      wrongAud: idToken({ aud: "evil-client.apps.googleusercontent.com" }),
      wrongIss: idToken({ iss: "https://evil.example.com" }),
      expired: idToken({ iat: now - 7200, exp: now - 3600 }),
      foreignKey: jwt.sign({ iss: "accounts.google.com", aud: WEB_CLIENT, sub: "x", email: "x@example.com", email_verified: true, iat: now, exp: now + 60 }, other, { algorithm: "RS256", keyid: KID }),
      hsWithPem: jwt.sign({ iss: "accounts.google.com", aud: WEB_CLIENT, sub: "y", email: "y@example.com", email_verified: true, iat: now, exp: now + 60 }, pem, { algorithm: "HS256", keyid: KID } as never),
    };
    for (const [name, tok] of Object.entries(cases)) {
      const sub = (jwt.decode(tok) as { sub: string }).sub;
      const res = await signIn(tok);
      expect(res.status, name).toBe(401);
      expectErrorShape(res, 401, "UNAUTHENTICATED");
      expect(await prisma.user.count({ where: { googleSub: sub } }), name).toBe(0);
    }
  });

  it("email_verified false (or the string 'true', or missing) → 401 EMAIL_NOT_VERIFIED and no user row", async () => {
    for (const v of [false, "true", undefined]) {
      const sub = `g-${randomUUID()}`;
      const res = await signIn(idToken({ sub, email_verified: v }));
      expectErrorShape(res, 401, "EMAIL_NOT_VERIFIED");
      expect(await prisma.user.count({ where: { googleSub: sub } })).toBe(0);
    }
  });

  it("/auth/google is rate limited to 20/min per IP", async () => {
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await signIn("garbage");
      if (res.status === 429) {
        limited++;
        expectErrorShape(res, 429, "RATE_LIMITED");
      }
    }
    expect(limited).toBeGreaterThanOrEqual(5);
  });
});

describe("attack 2: /dev/login-as in production", () => {
  const saved = { NODE_ENV: config.NODE_ENV, DEMO_KEY: config.DEMO_KEY };
  afterEach(() => {
    config.NODE_ENV = saved.NODE_ENV;
    config.DEMO_KEY = saved.DEMO_KEY;
  });

  it("NODE_ENV=production without DEMO_KEY: the route doesn't exist (no token issued)", async () => {
    config.NODE_ENV = "production";
    config.DEMO_KEY = undefined;
    const prodApp = createApp();
    const res = await request(prodApp).post(`/api/dev/login-as/${SEED_USERS[0]}`);
    expect(res.status).not.toBe(200);
    expect(res.body.token).toBeUndefined();
    expectErrorShape(res);
  });

  it("NODE_ENV=production with DEMO_KEY: missing or wrong x-demo-key → 404", async () => {
    config.NODE_ENV = "production";
    config.DEMO_KEY = "demo-key-123456";
    const prodApp = createApp();
    expectErrorShape(await request(prodApp).post(`/api/dev/login-as/${SEED_USERS[0]}`), 404);
    expectErrorShape(await request(prodApp).post(`/api/dev/login-as/${SEED_USERS[0]}`).set("x-demo-key", "wrong"), 404);
    await request(prodApp).post(`/api/dev/login-as/${SEED_USERS[0]}`).set("x-demo-key", "demo-key-123456").expect(200);
  });

  it("[API-AUTH-1] the demo key only logs in as SEEDED demo users, never as a real Google account", async () => {
    const realUser = await makeUser({ email: `real-${randomUUID().slice(0, 8)}@example.com` });
    config.NODE_ENV = "production";
    config.DEMO_KEY = "demo-key-123456";
    const prodApp = createApp();
    const res = await request(prodApp).post(`/api/dev/login-as/${realUser.id}`).set("x-demo-key", "demo-key-123456");
    // backend/12 step 4 + database/10: login-as exists for the seeded demo users only.
    expect(res.status, "a holder of the shared demo key can impersonate any real user by id").toBe(404);
    expect(res.body.token).toBeUndefined();
  });
});
