import { randomUUID } from "node:crypto";
import { UPLOAD_CONTENT_TYPES, type PresignRequest, type PresignResponse } from "../../contracts/uploads.js";
import { AppError } from "../../lib/errors.js";
import { PUT_EXPIRY_SECONDS, presignPut, type PresignPut } from "../../lib/s3.js";

// userId comes from the auth token, but it lands in an S3 key, so refuse anything that isn't a plain id.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function presignUpload(
  userId: string,
  { contentType, purpose }: PresignRequest,
  presign: PresignPut = presignPut,
): Promise<PresignResponse> {
  if (!SAFE_ID.test(userId)) throw new AppError(401, "UNAUTHENTICATED", "Invalid user");
  const ext = UPLOAD_CONTENT_TYPES[contentType];
  if (!ext) throw new AppError(400, "VALIDATION_ERROR", "Unsupported content type");
  const key = `${purpose}/${userId}/${randomUUID()}.${ext}`;
  const uploadUrl = await presign(key, contentType, PUT_EXPIRY_SECONDS);
  return { uploadUrl, key };
}
