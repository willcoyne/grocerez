import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { User } from "../src/contracts/auth.js";
import { prisma } from "../src/db.js";
import { presignGet, presignPut } from "../src/lib/s3.js";
import { signAppToken } from "../src/middleware/auth.js";

// No AWS: both presigners are stubbed with deterministic fake URLs.
vi.mock("../src/lib/s3.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/s3.js")>()),
  presignPut: vi.fn(async (key: string) => `https://put.test/${key}`),
  presignGet: vi.fn(async (key: string) => `https://get.test/${key}`),
}));

const GOOGLE_PIC = "https://pic/google.png";
let me: { id: string; auth: { Authorization: string } };
let other: { id: string; auth: { Authorization: string } };

async function makeUser() {
  const sub = `test-avatar-${randomUUID()}`;
  const u = await prisma.user.create({ data: { googleSub: sub, email: `${sub}@example.com`, displayName: "A", avatarUrl: GOOGLE_PIC } });
  return { id: u.id, auth: { Authorization: `Bearer ${signAppToken(u.id)}` } };
}

beforeAll(async () => {
  me = await makeUser();
  other = await makeUser();
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } });
  await prisma.$disconnect();
});

const presign = (auth: object, body: object) => request(app).post("/api/uploads/presign").set(auth).send(body);
const patchMe = (auth: object, body: object) => request(app).patch("/api/me").set(auth).send(body);

describe("POST /api/uploads/presign (mounted)", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/uploads/presign").send({ contentType: "image/png", purpose: "avatar" });
    expect(res.status).toBe(401);
    expect(presignPut).not.toHaveBeenCalled();
  });

  it("issues a key under the caller's own id", async () => {
    const res = await presign(me.auth, { contentType: "image/png", purpose: "avatar" });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(new RegExp(`^avatar/${me.id}/[0-9a-f-]{36}\\.png$`));
    expect(res.body.uploadUrl).toBe(`https://put.test/${res.body.key}`);
  });
});

describe("PATCH /api/me {avatarKey}", () => {
  it("presign -> PATCH -> avatarUrl is a presigned GET of the key, on GET /me too", async () => {
    const { key } = (await presign(me.auth, { contentType: "image/webp", purpose: "avatar" })).body;
    const res = await patchMe(me.auth, { avatarKey: key });
    expect(res.status).toBe(200);
    const user = User.parse(res.body);
    expect(user.avatarUrl).toBe(`https://get.test/${key}`);
    expect(res.body.avatarKey).toBeUndefined(); // stored key is never exposed
    expect(presignGet).toHaveBeenCalledWith(key);

    expect((await request(app).get("/api/me").set(me.auth)).body.avatarUrl).toBe(`https://get.test/${key}`);
    expect((await prisma.user.findUnique({ where: { id: me.id } }))!.avatarKey).toBe(key);
  });

  it("null clears it and falls back to the Google picture", async () => {
    const res = await patchMe(me.auth, { avatarKey: null });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(GOOGLE_PIC);
  });

  it("can be combined with other fields", async () => {
    const { key } = (await presign(me.auth, { contentType: "image/jpeg", purpose: "avatar" })).body;
    const res = await patchMe(me.auth, { avatarKey: key, displayName: "New" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: "New", avatarUrl: `https://get.test/${key}` });
  });

  it("rejects another user's avatar key", async () => {
    const { key } = (await presign(other.auth, { contentType: "image/png", purpose: "avatar" })).body;
    const res = await patchMe(me.auth, { avatarKey: key });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    (id: string) => `item-photo/${id}/${randomUUID()}.png`,
    (id: string) => `avatar/${id}/../${randomUUID()}.png`,
    (id: string) => `avatar/${id}/${randomUUID()}.png/../../x`,
    (id: string) => `avatar/${id}/${randomUUID()}.gif`,
    (id: string) => `avatar/${id}/`,
    (id: string) => `products/${id}.jpg`,
    () => "",
  ])("rejects malformed key %#", async (make) => {
    const before = (await prisma.user.findUnique({ where: { id: me.id } }))!.avatarKey;
    const res = await patchMe(me.auth, { avatarKey: make(me.id) });
    expect(res.status).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: me.id } }))!.avatarKey).toBe(before);
  });

  it("rejects non-string and oversized keys", async () => {
    expect((await patchMe(me.auth, { avatarKey: 42 })).status).toBe(400);
    expect((await patchMe(me.auth, { avatarKey: `avatar/${me.id}/${"a".repeat(300)}` })).status).toBe(400);
  });
});
