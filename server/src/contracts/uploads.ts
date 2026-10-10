import { z } from "zod";

export const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export const UploadPurpose = z.enum(["avatar", "item-photo"]);

export const PresignBody = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  purpose: UploadPurpose,
});
export type PresignBody = z.infer<typeof PresignBody>;

/**
 * PUT the file to uploadUrl with header `Content-Type: <contentType>` within 5 minutes, then send `key` to
 * PATCH /me {avatarKey} or PATCH /groups/:groupId/cabinet/:id {photoKey}.
 */
export const PresignResponse = z.object({ uploadUrl: z.string(), key: z.string() });
export type PresignResponse = z.infer<typeof PresignResponse>;

/** Key format the API hands out (and accepts back): `${purpose}/${userId}/${uuid}.${ext}`. */
export const uploadKeyPattern = (purpose: "avatar" | "item-photo", userId: string) =>
  new RegExp(`^${purpose}/${userId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
