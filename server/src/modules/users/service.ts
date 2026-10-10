import { AppError } from "../../lib/errors.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";
import { usersRepo } from "./repo.js";

export async function getMe(userId: string): Promise<User> {
  const user = await usersRepo.find(userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  return user;
}

export const updateMe = (userId: string, data: UpdateMeBody) => usersRepo.update(userId, data);

// ponytail: groups don't exist yet; backend/03 adds the owner handover (database/11) here, in a transaction.
export const deleteMe = (userId: string) => usersRepo.delete(userId);
