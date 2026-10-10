// Break tests (M1): presigned uploads (plan backend/11). Signing is offline (fake credentials, no AWS call).
// Tests named "[DEFECT B-xx]" are expected to FAIL.
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db.js";
import { GET_EXPIRY_SECONDS, PUT_EXPIRY_SECONDS, presignGet, presignPut } from "../../src/lib/s3.js";
import { requireAuth, signAppToken } from "../../src/middleware/auth.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { createUploadsRouter } from "../../src/modules/uploads/router.js";

const sub = `break-up-${randomUUID()}`;
afterAll(async () => {
  await prisma.user.deleteMany({ where: { googleSub: sub } });
  await prisma.$disconnect();
});

describe("mounted the way the plan says: under /api behind requireAuth", () => {
  it("[DEFECT B-15] a signed-in user can get a presigned URL (router reads req.user.id, requireAuth sets req.userId)", async () => {
    const user = await prisma.user.create({ data: { googleSub: sub, email: `${sub}@example.com`, displayName: "U" } });
    const presign = vi.fn(async (key: string) => `https://test-bucket.s3.amazonaws.com/${key}?sig=x`);
    const app = express();
    app.use(express.json());
    app.use("/api", requireAuth);
    app.use("/api", createUploadsRouter(presign));
    app.use(errorHandler);
    const res = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${signAppToken(user.id)}`)
      .send({ contentType: "image/png", purpose: "avatar" });
    expect(res.status).toBe(200); // actual: 401 UNAUTHENTICATED "Sign in required" for every user
    expect(res.body.key).toMatch(new RegExp(`^avatar/${user.id}/[0-9a-f-]{36}\\.png$`));
  });
});

describe("presigned PUT URL", () => {
  it("expires in 5 minutes and signs content-type + host only", async () => {
    const u = new URL(await presignPut("avatar/u1/a.png", "image/png", PUT_EXPIRY_SECONDS));
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(u.hostname).toBe("test-bucket.s3.us-east-1.amazonaws.com");
    expect(u.searchParams.get("x-amz-acl")).toBeNull(); // never public-read
  });

  it("[DEFECT B-16] does not pin a checksum of an EMPTY body into the URL (every real upload would fail with a checksum mismatch)", async () => {
    // @aws-sdk/client-s3 >= 3.729 computes flexible checksums by default; at presign time the body is empty, so the
    // URL carries x-amz-checksum-crc32=AAAAAA== (CRC32 of zero bytes). Query params are signed, so the app can't drop it.
    const u = new URL(await presignPut("avatar/u1/a.png", "image/png", PUT_EXPIRY_SECONDS));
    expect(u.searchParams.get("x-amz-checksum-crc32")).not.toBe("AAAAAA==");
  });

  it("GET URLs expire in 1 hour", async () => {
    const u = new URL(await presignGet("avatar/u1/a.png"));
    expect(u.searchParams.get("X-Amz-Expires")).toBe(String(GET_EXPIRY_SECONDS));
    expect(GET_EXPIRY_SECONDS).toBe(3600);
  });
});
