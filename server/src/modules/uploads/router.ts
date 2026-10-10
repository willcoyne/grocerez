import { randomUUID } from "node:crypto";
import { Router } from "express";
import { PresignBody, type PresignResponse, UPLOAD_TYPES } from "../../contracts/uploads.js";
import { uid } from "../../middleware/auth.js";
import { perUser } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import { s3 } from "../../lib/s3.js";

export const uploadsRouter = Router();

/** POST /uploads/presign {contentType, purpose} → {uploadUrl, key}. File bytes never pass through the API. */
uploadsRouter.post("/uploads/presign", perUser(30, 60_000, "presign"), validate({ body: PresignBody }), async (req, res) => {
  const { contentType, purpose } = req.body as PresignBody;
  const key = `${purpose}/${uid(req)}/${randomUUID()}.${UPLOAD_TYPES[contentType]}`;
  const body: PresignResponse = { uploadUrl: await s3.presignPut(key, contentType), key };
  res.json(body);
});
