// Break tests (M1): POST /api/auth/google with the REAL google-auth-library verifier.
// Only the Google cert download is stubbed (our own RSA key stands in for Google's), so audience, issuer, expiry,
// signature and alg checks are all exercised for real. No network.
// Keep the number of /auth/google calls in this file under the 20/min limiter.
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { OAuth2Client } from "google-auth-library";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/db.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const KID = "break-kid";
const AUD = "test-client-id"; // GOOGLE_CLIENT_IDS in vitest.config.ts

const subs: string[] = [];
function googleToken(over: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) {
  const sub = `break-g-${randomUUID()}`;
  subs.push(sub);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://accounts.google.com", aud: AUD, sub, email: `${sub}@example.com`, email_verified: true,
    iat: now, exp: now + 3600, name: "Break Tester", ...over,
  };
  return jwt.sign(payload, privateKey, { algorithm: "RS256", keyid: KID, ...opts });
}
const post = (idToken: unknown) => request(app).post("/api/auth/google").send({ idToken });

beforeAll(() => {
  vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
    certs: { [KID]: PUB_PEM },
    format: "PEM",
  } as never);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { googleSub: { in: subs } } });
  await prisma.$disconnect();
});

describe("Google ID token verification (real library, stubbed certs)", () => {
  it("control: a correctly signed token for our audience signs in", async () => {
    const res = await post(googleToken());
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
  });

  it.each([
    ["wrong audience", () => googleToken({ aud: "someone-elses-client.apps.googleusercontent.com" })],
    ["wrong issuer", () => googleToken({ iss: "https://evil.example" })],
    ["expired", () => googleToken({ iat: 1_000_000, exp: 1_000_100 })],
    ["email_verified false", () => googleToken({ email_verified: false })],
    ["email_verified as the string 'true'", () => googleToken({ email_verified: "true" })],
    ["no email claim", () => googleToken({ email: undefined })],
    ["unknown kid", () => googleToken({}, { keyid: "other" })],
    ["alg none", () => jwt.sign({ iss: "https://accounts.google.com", aud: AUD, sub: "x", email: "x@e.com", email_verified: true }, "", { algorithm: "none" })],
    ["HS256 signed with Google's public key (alg confusion)", () => {
      const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: KID })).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: AUD, sub: "x", email: "x@e.com", email_verified: true, iat: now, exp: now + 600 })).toString("base64url");
      const sig = createHmac("sha256", PUB_PEM).update(`${h}.${p}`).digest("base64url");
      return `${h}.${p}.${sig}`;
    }],
  ])("%s -> 401 UNAUTHENTICATED, no user row", async (_name, make) => {
    const before = await prisma.user.count();
    const res = await post(make());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHENTICATED", message: expect.any(String) } });
    expect(await prisma.user.count()).toBe(before);
  });
});

describe("input validation on /auth/google", () => {
  it.each([[123], [["a"]], [{ a: 1 }], [null], ["x".repeat(4097)]])("idToken %j -> 400 VALIDATION_ERROR", async (bad) => {
    const res = await post(bad);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/); // no stack traces
  });
});
