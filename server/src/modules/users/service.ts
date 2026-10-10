import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { emitGroup, kickFromGroup } from "../../lib/realtime.js";
import { groupsRepo } from "../groups/repo.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";
import { usersRepo } from "./repo.js";

type UserRow = { id: string; email: string; displayName: string; avatarUrl: string | null; zipCode: string | null };

// The one place a DB user row becomes the public User (backend/11 extends it with presigned avatar URLs).
export const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
  zipCode: row.zipCode,
});

export async function getMe(userId: string): Promise<User> {
  const user = await usersRepo.find(userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  return user;
}

export const updateMe = (userId: string, data: UpdateMeBody) => usersRepo.update(userId, data);

// Leaves every group first (owner handover / empty-group cleanup, database/11), then deletes the user. One transaction.
export async function deleteMe(userId: string): Promise<User> {
  const { user, groupIds } = await prisma.$transaction(async (tx) => {
    const groupIds = (await groupsRepo.groupIdsForUser(userId, tx)).sort(); // fixed lock order
    for (const groupId of groupIds) {
      await groupsRepo.lock(tx, groupId);
      await groupsRepo.removeMember(tx, groupId, userId);
    }
    return { user: await usersRepo.delete(userId, tx), groupIds };
  });
  for (const groupId of groupIds) {
    await kickFromGroup(groupId, userId);
    emitGroup(groupId, "group:changed", userId);
  }
  return user;
}
