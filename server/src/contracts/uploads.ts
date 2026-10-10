import { z } from "zod";

export const UPLOAD_CONTENT_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

// Unknown fields (e.g. a client-supplied "key" or "filename") are stripped; the key is always server-generated.
export const PresignRequest = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  purpose: z.enum(["avatar", "item-photo"]),
});
export type PresignRequest = z.infer<typeof PresignRequest>;

export const PresignResponse = z.object({ uploadUrl: z.string().url(), key: z.string() });
export type PresignResponse = z.infer<typeof PresignResponse>;
