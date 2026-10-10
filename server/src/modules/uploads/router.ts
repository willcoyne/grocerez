import { Router } from "express";
import { PresignRequest } from "../../contracts/uploads.js";
import { AppError } from "../../lib/errors.js";
import type { PresignPut } from "../../lib/s3.js";
import { validate } from "../../middleware/validate.js";
import { presignUpload } from "./service.js";

// Must be mounted behind requireAuth (backend/02), which sets req.user.
export function createUploadsRouter(presign?: PresignPut) {
  const router = Router();
  router.post("/uploads/presign", validate({ body: PresignRequest }), async (req, res) => {
    const userId = (req as { user?: { id?: string } }).user?.id;
    if (!userId) throw new AppError(401, "UNAUTHENTICATED", "Sign in required");
    res.json(await presignUpload(userId, req.body, presign));
  });
  return router;
}

export const uploadsRouter = createUploadsRouter();
