import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { emitGroup, kickFromGroup } from "../../lib/realtime.js";
import { groupsRepo } from "../groups/repo.js";
import { presignGet } from "../../lib/s3.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";
import type { Dietary } from "../../contracts/dietary.js";
import { generate, inListTx } from "../shopping-list/service.js";
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

// Leaves every group first (owner handover / empty-group cleanup, database/11), then deletes the user. One transaction.
export async function deleteMe(userId: string): Promise<User> {
  const { user, groupIds } = await prisma.$transaction(async (tx) => {
    const groupIds = (await groupsRepo.groupIdsForUser(userId, tx)).sort(); // fixed lock order
    for (const groupId of groupIds) {
      await groupsRepo.lock(tx, groupId);
      if (!(await groupsRepo.removeMember(tx, groupId, userId)).groupDeleted) await generate(groupId, tx);
    }
    return { user: await usersRepo.delete(userId, tx), groupIds };
  });
  for (const groupId of groupIds) {
    await kickFromGroup(groupId, userId);
    emitGroup(groupId, "group:changed", userId);
    emitGroup(groupId, "shopping-list:changed", userId);
  }
  return toUser(user);
}

export const getDietary = (userId: string) => usersRepo.dietary(userId);

// Allergens drive the list's allergen flags, so every group the user is in regenerates (one transaction per group).
export async function setDietary(userId: string, body: Dietary): Promise<Dietary> {
  await usersRepo.setDietary(userId, body);
  for (const groupId of await groupsRepo.groupIdsForUser(userId)) {
    await inListTx(groupId, (tx) => generate(groupId, tx));
    emitGroup(groupId, "shopping-list:changed", userId);
  }
  return usersRepo.dietary(userId);
}
