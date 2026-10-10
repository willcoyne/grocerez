import { z } from "zod";

export const User = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  zipCode: z.string().nullable(),
});
export type User = z.infer<typeof User>;

export const GoogleLoginBody = z.object({ idToken: z.string().min(1).max(4096) });
export type GoogleLoginBody = z.infer<typeof GoogleLoginBody>;

export const AuthResponse = z.object({ token: z.string(), user: User });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const UpdateMeBody = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    // US ZIP (5 digits, optional +4). null clears it.
    zipCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "must be a US ZIP code").nullable().optional(),
  })
  .strict();
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

export const UserIdParams = z.object({ userId: z.uuid() });
