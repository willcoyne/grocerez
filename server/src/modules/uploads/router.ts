import { Router } from "express";
import { PresignRequest } from "../../contracts/uploads.js";
import { AppError } from "../../lib/errors.js";
import type { PresignPut } from "../../lib/s3.js";
import { validate } from "../../middleware/validate.js";
import { presignUpload } from "./service.js";

// Mounted behind requireAuth, which sets req.userId.
export function createUploadsRouter(presign?: PresignPut) {
  const router = Router();
  router.post("/uploads/presign", validate({ body: PresignRequest }), async (req, res) => {
    if (!req.userId) throw new AppError(401, "UNAUTHENTICATED", "Sign in required");
    res.json(await presignUpload(req.userId, req.body, presign));
  });
  return router;
}

export const uploadsRouter = createUploadsRouter();
