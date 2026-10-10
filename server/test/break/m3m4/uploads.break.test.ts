// Break tests (M3/M4): photoKey / avatarKey ownership and presign content types (plan backend/11 step 4).
// The presigner is the real AWS SDK with fake credentials (pure signing, no network).
// Tests named "[DEFECT M3-xx]" are expected to FAIL.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../../src/app.js";
import { Group } from "../../../src/contracts/groups.js";
import { prisma } from "../../../src/db.js";
import { cleanupUsers, makeUser } from "../../helpers.js";

type U = Awaited<ReturnType<typeof makeUser>>;
const api = () => request(app);
const tag = randomUUID().replace(/[^a-f]/g, "").slice(0, 6) + "zu";
let a: U, b: U, g: Group, cabId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([makeUser(), makeUser()]);
  g = Group.parse((await api().post("/api/groups").set(a.auth).send({ name: "Up" }).expect(201)).body);
  const item = await prisma.item.create({ data: { name: `Photoitem ${tag}`, normalizedName: `photoitem ${tag}`, category: "pantry" } });
  cabId = (await api().post(`/api/groups/${g.id}/cabinet`).set(a.auth).send({ itemId: item.id }).expect(200)).body.id;
});
afterAll(async () => {
  await cleanupUsers();
  await prisma.item.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
});

const presign = (body: object, u = a) => api().post("/api/uploads/presign").set(u.auth).send(body);
const setPhoto = (photoKey: unknown) => api().patch(`/api/groups/${g.id}/cabinet/${cabId}`).set(a.auth).send({ photoKey });
const setAvatar = (avatarKey: unknown, u = a) => api().patch("/api/me").set(u.auth).send({ avatarKey });

describe("presign", () => {
  it.each(["image/svg+xml", "text/html", "image/gif", "IMAGE/PNG", "image/jpeg; charset=utf-8", "image/jpeg ", "application/octet-stream", ""])(
    "contentType %j -> 400",
    async (contentType) => {
      const res = await presign({ contentType, purpose: "avatar" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    },
  );

  it.each(["products", "../avatar", "avatar/../../x", ""])("purpose %j -> 400", async (purpose) => {
    expect((await presign({ contentType: "image/png", purpose })).status).toBe(400);
  });

  it("client-supplied key/filename/userId are ignored; key is under the caller's prefix; 5-min expiry; content-type signed", async () => {
    const res = await presign({ contentType: "image/png", purpose: "item-photo", key: `item-photo/${b.id}/x.png`, filename: "../../x", userId: b.id });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(new RegExp(`^item-photo/${a.id}/[0-9a-f-]{36}\\.png$`));
    const url = new URL(res.body.uploadUrl);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.pathname).toContain(res.body.key);
    expect(url.search).not.toContain("x-amz-checksum-crc32");
  });

  it("no token -> 401", async () => {
    expect((await api().post("/api/uploads/presign").send({ contentType: "image/png", purpose: "avatar" })).status).toBe(401);
  });
});

describe("photoKey ownership (PATCH cabinet)", () => {
  const u = () => randomUUID();
  it("own issued key is accepted and comes back only as a presigned URL", async () => {
    const { key } = (await presign({ contentType: "image/webp", purpose: "item-photo" })).body;
    const res = await setPhoto(key);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("photoKey");
    expect(res.body.photoUrl).toContain(encodeURI(key).replace(/\//g, "/"));
  });

  it.each([
    () => `item-photo/${b.id}/${u()}.jpg`, // another user's key
    () => `avatar/${a.id}/${u()}.jpg`, // own avatar, wrong purpose
    () => `products/${u()}.jpg`, // server product images
    () => `item-photo/${a.id}/../${b.id}/${u()}.jpg`,
    () => `item-photo/${a.id}/${u()}.jpg/../../${b.id}/${u()}.jpg`,
    () => `/item-photo/${a.id}/${u()}.jpg`,
    () => `item-photo/${a.id.toUpperCase()}/${u()}.jpg`,
    () => `item-photo/${a.id}/${u()}.svg`,
    () => `item-photo/${a.id}/${u()}.jpg\n`,
    () => `https://evil.example/item-photo/${a.id}/${u()}.jpg`,
    () => `item-photo/${a.id}/${u()}.jpg?x=1`,
  ])("rejects foreign/odd key #%#", async (mk) => {
    const res = await setPhoto(mk());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    () => `item-photo/${a.id}/${u()}xjpg`,
    () => `item-photo/${a.id}/${"-".repeat(36)}/jpg`,
  ])("[DEFECT M3-18] photoKey regex: unescaped '.' in a template literal accepts keys /uploads/presign never issues (#%#)", async (mk) => {
    expect((await setPhoto(mk())).status).toBe(400);
  });

  it.each([5, {}, ["x"], "a".repeat(201)])("photoKey %j -> 400", async (k) => {
    expect((await setPhoto(k)).status).toBe(400);
  });
});

describe("avatarKey ownership (PATCH /me)", () => {
  it.each([
    () => `avatar/${b.id}/${randomUUID()}.png`,
    () => `item-photo/${a.id}/${randomUUID()}.png`,
    () => `avatar/${a.id}/../${b.id}/${randomUUID()}.png`,
    () => `avatar/${a.id}/${randomUUID()}xpng`,
  ])("rejects #%#", async (mk) => {
    expect((await setAvatar(mk())).status).toBe(400);
  });
  it("own issued avatar key is accepted; null clears it", async () => {
    const { key } = (await presign({ contentType: "image/png", purpose: "avatar" })).body;
    expect((await setAvatar(key)).status).toBe(200);
    expect((await setAvatar(null)).status).toBe(200);
  });
});
