import type { AuthResponse } from "../../contracts/auth.js";
import { AppError } from "../../lib/errors.js";
import { verifyGoogleIdToken, type GoogleIdentity } from "../../lib/google.js";
import { signAppToken } from "../../middleware/auth.js";
import { usersRepo } from "../users/repo.js";

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  let identity: GoogleIdentity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid Google ID token");
  }
  if (!identity.emailVerified) throw new AppError(401, "UNAUTHENTICATED", "Google email is not verified");
  const user = await usersRepo.upsertFromGoogle(identity);
  return { token: signAppToken(user.id), user };
}

export async function devLoginAs(userId: string): Promise<AuthResponse> {
  const user = await usersRepo.find(userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  return { token: signAppToken(user.id), user };
}
