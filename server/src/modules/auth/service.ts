import type { AuthResponse } from "../../contracts/auth.js";
import { AppError } from "../../lib/errors.js";
import { verifyGoogleIdToken, type GoogleIdentity } from "../../lib/google.js";
import { signAppToken } from "../../middleware/auth.js";
import { usersRepo } from "../users/repo.js";
import { toUser } from "../users/service.js";

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  let identity: GoogleIdentity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid Google ID token");
  }
  if (!identity.emailVerified) throw new AppError(401, "UNAUTHENTICATED", "Google email is not verified");
  const user = await toUser(await usersRepo.upsertFromGoogle(identity));
  return { token: signAppToken(user.id), user };
}

export async function devLoginAs(userId: string): Promise<AuthResponse> {
  // Only seeded demo users (plan 02 step 6), so the dev backdoor can't take over real accounts on a non-prod box.
  const user = await usersRepo.findSeeded(userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "Demo user not found");
  return { token: signAppToken(user.id), user: await toUser(user) };
}
