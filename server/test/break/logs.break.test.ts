// Break tests (M1): grep the logs produced during real requests for tokens, emails, and secrets (GAPS #26:
// "no personal data in logs"). pino is wrapped so the app's own logger config (incl. its redact list) is used at
// level "info" and written to an in-memory buffer instead of being silenced by NODE_ENV=test.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const captured: string[] = [];
vi.mock("pino", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pino")>();
  const sink = new Writable({ write(chunk, _enc, cb) { captured.push(String(chunk)); cb(); } });
  const wrapped = (opts: Record<string, unknown> = {}) => actual.pino({ ...opts, level: "info" }, sink);
  return { ...actual, pino: Object.assign(wrapped, actual.pino), default: Object.assign(wrapped, actual.pino) };
});
vi.mock("../../src/lib/google.js", () => ({ verifyGoogleIdToken: vi.fn() }));

const { app } = await import("../../src/app.js");
const { prisma } = await import("../../src/db.js");
const { verifyGoogleIdToken } = await import("../../src/lib/google.js");
const { callStructured } = await import("../../src/modules/ai/client.js");

const GOOGLE_ID_TOKEN = "eyJGOOGLE.break-google-id-token-SECRET.sig";
const ANTHROPIC_KEY = "sk-ant-break-SECRET-0123456789";
const sub = `break-logs-${randomUUID()}`;
const email = `${sub}@example.com`;
const logs = () => captured.join("");

let fakeClaude: Server;
let claudeUrl = "";

beforeAll(async () => {
  fakeClaude = createServer((req, res) => {
    req.resume();
    res.writeHead(401, { "content-type": "application/json", "request-id": "req_break" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
  });
  await new Promise<void>((r) => fakeClaude.listen(0, "127.0.0.1", r));
  claudeUrl = `http://127.0.0.1:${(fakeClaude.address() as AddressInfo).port}`;
});
afterAll(async () => {
  fakeClaude.close();
  await prisma.user.deleteMany({ where: { googleSub: sub } });
  await prisma.$disconnect();
});

describe("log leak sweep", () => {
  it("logs are actually being captured (sanity)", async () => {
    await request(app).get("/api/health");
    expect(logs()).toContain("request completed");
  });

  it("sign-in, authenticated calls, a 500, and a failed Claude call leak no token, email, or secret", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce({ sub, email, emailVerified: true, name: "Leak Test" });
    const login = await request(app).post("/api/auth/google").send({ idToken: GOOGLE_ID_TOKEN });
    expect(login.status).toBe(200);
    const appJwt: string = login.body.token;

    await request(app).get("/api/me").set("Authorization", `Bearer ${appJwt}`);
    await request(app).get("/api/me").set("authorization", `bearer ${appJwt}`); // odd casing still redacted?
    await request(app).get("/api/me").set("Cookie", `session=${appJwt}`);
    await request(app).patch("/api/me").set("Authorization", `Bearer ${appJwt}`).send({ displayName: "x\u0000y" }); // 500 path

    const client = new Anthropic({ apiKey: ANTHROPIC_KEY, baseURL: claudeUrl, maxRetries: 0 });
    await expect(
      callStructured(client as never, { effort: "low", messages: [{ role: "user", content: "hi" }] }, z.object({ a: z.string() })),
    ).rejects.toMatchObject({ status: 503, code: "AI_UNAVAILABLE" });

    const out = logs();
    const [, jwtPayload, jwtSig] = appJwt.split(".");
    const leaks = {
      googleIdToken: out.includes("break-google-id-token-SECRET"),
      appJwtSignature: out.includes(jwtSig),
      appJwtPayload: out.includes(jwtPayload),
      email: out.toLowerCase().includes(email.toLowerCase()),
      jwtSecret: out.includes(process.env.JWT_SECRET!),
      anthropicKey: out.includes(ANTHROPIC_KEY),
      awsSecret: /"aws_?secret|secretAccessKey/i.test(out),
    };
    expect(leaks, out.slice(-4000)).toEqual({
      googleIdToken: false, appJwtSignature: false, appJwtPayload: false, email: false, jwtSecret: false,
      anthropicKey: false, awsSecret: false,
    });
  });

  it("[DEFECT B-10] a token passed in the query string is not written to the access log", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce({ sub, email, emailVerified: true, name: "Leak Test" });
    const appJwt: string = (await request(app).post("/api/auth/google").send({ idToken: "x" })).body.token;
    captured.length = 0;
    await request(app).get(`/api/me?token=${appJwt}`).set("Authorization", `Bearer ${appJwt}`);
    expect(logs()).not.toContain(appJwt.split(".")[2]);
  });
});
