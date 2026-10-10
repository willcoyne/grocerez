import { z } from "zod";

export const GoogleAuthBody = z.object({ idToken: z.string().min(1).max(8192) });
export type GoogleAuthBody = z.infer<typeof GoogleAuthBody>;

export const User = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  /** Google picture URL, or a presigned S3 GET URL when the user uploaded an avatar (11). */
  avatarUrl: z.string().nullable(),
  zipCode: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof User>;

export const AuthResponse = z.object({ token: z.string(), user: User });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const UpdateMeBody = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    /** 5-digit US ZIP, or null to clear. */
    zipCode: z.string().regex(/^\d{5}$/, "must be a 5-digit ZIP code").nullable().optional(),
  })
  .strict();
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;
