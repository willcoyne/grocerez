import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { PUT_EXPIRY_SECONDS, presignPut } from "../src/lib/s3.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { createUploadsRouter } from "../src/modules/uploads/router.js";
import { presignUpload } from "../src/modules/uploads/service.js";

const USER = "user_123";
const KEY_RE = /^(avatar|item-photo)\/user_123\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

function setup(userId: string | null = USER) {
  const presign = vi.fn(async (key: string) => `https://test-bucket.s3.amazonaws.com/${key}?sig=x`);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) (req as unknown as { user: { id: string } }).user = { id: userId };
    next();
  });
  app.use("/api", createUploadsRouter(presign));
  app.use(errorHandler);
  return { app, presign };
}

describe("POST /api/uploads/presign", () => {
  it("returns {uploadUrl, key} under purpose/userId with a 5-minute expiry", async () => {
    const { app, presign } = setup();
    const res = await request(app).post("/api/uploads/presign").send({ contentType: "image/png", purpose: "avatar" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["key", "uploadUrl"]);
    expect(res.body.key).toMatch(/^avatar\/user_123\/[0-9a-f-]{36}\.png$/);
    expect(presign).toHaveBeenCalledWith(res.body.key, "image/png", 300);
    expect(PUT_EXPIRY_SECONDS).toBe(300);
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ])("maps %s to .%s", async (contentType, ext) => {
    const { app } = setup();
    const res = await request(app).post("/api/uploads/presign").send({ contentType, purpose: "item-photo" });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(KEY_RE);
    expect(res.body.key.endsWith(`.${ext}`)).toBe(true);
  });

  it.each(["image/gif", "image/svg+xml", "text/html", "application/octet-stream", "image/png; charset=x", "IMAGE/PNG", ""])(
    "rejects content type %j",
    async (contentType) => {
      const { app, presign } = setup();
      const res = await request(app).post("/api/uploads/presign").send({ contentType, purpose: "avatar" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(presign).not.toHaveBeenCalled();
    },
  );

  it.each(["../avatar", "products", "avatar/../../x", "", undefined])("rejects purpose %j", async (purpose) => {
    const { app, presign } = setup();
    const res = await request(app).post("/api/uploads/presign").send({ contentType: "image/png", purpose });
    expect(res.status).toBe(400);
    expect(presign).not.toHaveBeenCalled();
  });

  it("ignores client-supplied key/filename/userId fields", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/uploads/presign").send({
      contentType: "image/png",
      purpose: "avatar",
      key: "../../products/1.jpg",
      filename: "../../../etc/passwd",
      userId: "someone-else",
    });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(KEY_RE);
    expect(res.body.key).not.toContain("..");
  });

  it("returns 401 when no user is set", async () => {
    const { app, presign } = setup(null);
    const res = await request(app).post("/api/uploads/presign").send({ contentType: "image/png", purpose: "avatar" });
    expect(res.status).toBe(401);
    expect(presign).not.toHaveBeenCalled();
  });

  it("generates a fresh key each call", async () => {
    const { app } = setup();
    const body = { contentType: "image/png", purpose: "avatar" };
    const a = await request(app).post("/api/uploads/presign").send(body);
    const b = await request(app).post("/api/uploads/presign").send(body);
    expect(a.body.key).not.toBe(b.body.key);
  });
});

describe("presignUpload", () => {
  it.each(["../x", "a/b", "a\\b", "", "x".repeat(65), "id with space"])("refuses unsafe userId %j", async (userId) => {
    const presign = vi.fn();
    await expect(presignUpload(userId, { contentType: "image/png", purpose: "avatar" }, presign)).rejects.toMatchObject({
      status: 401,
    });
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("lib/s3 presignPut (offline signing, no network)", () => {
  it("signs the key, content type, and a 300s expiry", async () => {
    const url = new URL(await presignPut("avatar/u1/abc.png", "image/png", PUT_EXPIRY_SECONDS));
    expect(url.pathname).toContain("avatar/u1/abc.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  });
});
