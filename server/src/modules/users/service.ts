import { AppError } from "../../lib/errors.js";
import { presignGet } from "../../lib/s3.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";
import { usersRepo, type UserRow } from "./repo.js";

// An uploaded avatar wins over the Google picture; the stored key is never exposed, only a 1-hour GET URL.
export async function toUser({ avatarKey, ...user }: UserRow): Promise<User> {
  return avatarKey ? { ...user, avatarUrl: await presignGet(avatarKey) } : user;
}

export async function getMe(userId: string): Promise<User> {
  const user = await usersRepo.find(userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  return toUser(user);
}

export async function updateMe(userId: string, data: UpdateMeBody): Promise<User> {
  // Exactly the shape presignUpload generates for this user (userId is a UUID, checked by requireAuth),
  // so nobody can claim another user's object.
  const ownKey = new RegExp(`^avatar/${userId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  if (data.avatarKey != null && !ownKey.test(data.avatarKey)) {
    throw new AppError(400, "VALIDATION_ERROR", "avatarKey must be an avatar key issued to you by /uploads/presign");
  }
  return toUser(await usersRepo.update(userId, data));
}

// ponytail: groups don't exist yet; backend/03 adds the owner handover (database/11) here, in a transaction.
export const deleteMe = async (userId: string) => toUser(await usersRepo.delete(userId));
