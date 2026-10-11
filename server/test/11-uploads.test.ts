import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { http } from "../src/lib/http.js";
import { s3 } from "../src/lib/s3.js";
import { copyProductImage } from "../src/modules/products/service.js";
import { api, itemId, makeGroup, makeUser } from "./helpers.js";

const S3_ENV = { AWS_REGION: "us-east-2", S3_BUCKET: "grocerez-test-assets", AWS_ACCESS_KEY_ID: "AKIATESTTESTTEST", AWS_SECRET_ACCESS_KEY: "test-secret" };
const saved: Record<string, string | undefined> = {};

function enableS3() {
  for (const [k, v] of Object.entries(S3_ENV)) {
    saved[k] = (config as Record<string, unknown>)[k] as string | undefined;
    (config as Record<string, unknown>)[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (config as Record<string, unknown>)[k] = v;
  vi.restoreAllMocks();
});

describe("11 without S3 configured", () => {
  it("POST /uploads/presign answers 503 NOT_CONFIGURED; responses still work with null image URLs", async () => {
    const u = await makeUser();
    const res = await api().post("/api/uploads/presign").set(u.auth).send({ contentType: "image/jpeg", purpose: "avatar" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("NOT_CONFIGURED");
  });
});

describe("11 with S3 configured (presigning is offline)", () => {
  beforeEach(enableS3);

  it("presigns a 5-minute PUT under {purpose}/{userId}/{uuid}.{ext}; only jpeg/png/webp", async () => {
    const u = await makeUser();
    const res = await api().post("/api/uploads/presign").set(u.auth).send({ contentType: "image/png", purpose: "item-photo" });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(new RegExp(`^item-photo/${u.id}/[0-9a-f-]{36}\\.png$`));
    const url = new URL(res.body.uploadUrl);
    expect(url.hostname).toBe("grocerez-test-assets.s3.us-east-2.amazonaws.com");
    expect(url.pathname).toBe(`/${res.body.key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("x-id")).toBe("PutObject");

    for (const body of [{ contentType: "image/gif", purpose: "avatar" }, { contentType: "image/png", purpose: "receipt" }, {}]) {
      expect((await api().post("/api/uploads/presign").set(u.auth).send(body)).status).toBe(400);
    }
  });

  it("PATCH /me {avatarKey} stores the key and avatars come back as 1-hour presigned GETs (also in the member list)", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const g = await makeGroup(u);
    const { body } = await api().post("/api/uploads/presign").set(u.auth).send({ contentType: "image/jpeg", purpose: "avatar" });
    const me = await api().patch("/api/me").set(u.auth).send({ avatarKey: body.key });
    expect(me.status).toBe(200);
    const avatar = new URL(me.body.avatarUrl);
    expect(avatar.pathname).toBe(`/${body.key}`);
    expect(avatar.searchParams.get("X-Amz-Expires")).toBe("3600");
    const detail = await api().get(`/api/groups/${g.id}`).set(u.auth);
    expect(new URL(detail.body.members[0].avatarUrl).pathname).toBe(`/${body.key}`);

    // Someone else's key, a wrong purpose or a made-up key is rejected.
    const theirs = await api().post("/api/uploads/presign").set(other.auth).send({ contentType: "image/jpeg", purpose: "avatar" });
    const bad = await api().patch("/api/me").set(u.auth).send({ avatarKey: theirs.body.key });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_UPLOAD_KEY");
    expect((await api().patch("/api/me").set(u.auth).send({ avatarKey: "../../etc/passwd" })).status).toBe(400);
    const cleared = await api().patch("/api/me").set(u.auth).send({ avatarKey: null });
    expect(cleared.body.avatarUrl).toBeNull();
  });

  it("PATCH cabinet {photoKey} adds a photoUrl", async () => {
    const u = await makeUser();
    const g = await makeGroup(u);
    const c = await api().post(`/api/groups/${g.id}/cabinet`).set(u.auth).send({ itemId: await itemId("Apples") });
    expect(c.body.photoUrl).toBeNull();
    const { body } = await api().post("/api/uploads/presign").set(u.auth).send({ contentType: "image/webp", purpose: "item-photo" });
    const res = await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(u.auth).send({ photoKey: body.key });
    expect(res.status).toBe(200);
    expect(new URL(res.body.photoUrl).pathname).toBe(`/${body.key}`);
    const avatarKey = (await api().post("/api/uploads/presign").set(u.auth).send({ contentType: "image/jpeg", purpose: "avatar" })).body.key;
    expect((await api().patch(`/api/groups/${g.id}/cabinet/${c.body.id}`).set(u.auth).send({ photoKey: avatarKey })).status).toBe(400);
  });

  it("product images from Open Food Facts are copied to products/{id}.jpg; other hosts are ignored", async () => {
    const product = await prisma.product.create({
      data: { itemId: await itemId("Oreos"), gtin: "00044000032029", name: "Oreo", source: "manual", fetchedAt: new Date() },
    });
    const put = vi.spyOn(s3, "putObject").mockResolvedValue();
    const net = vi.spyOn(http, "fetch").mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { "content-type": "image/jpeg" } }));
    await copyProductImage(product.id, "https://evil.example.com/x.jpg");
    expect(net).not.toHaveBeenCalled();
    await copyProductImage(product.id, "https://images.openfoodfacts.org/images/products/004/400/003/2029/front_en.jpg");
    expect(put).toHaveBeenCalledWith(`products/${product.id}.jpg`, expect.any(Uint8Array), "image/jpeg");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imageS3Key).toBe(`products/${product.id}.jpg`);
    // Already copied → no second download.
    await copyProductImage(product.id, "https://images.openfoodfacts.org/images/products/004/400/003/2029/front_en.jpg");
    expect(net).toHaveBeenCalledTimes(1);
  });
});
