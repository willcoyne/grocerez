import { prisma } from "../../db.js";
import type { AuthResponse, UpdateMeBody, User } from "../../contracts/auth.js";
import { AppError, notFound } from "../../lib/errors.js";
import { google } from "../../lib/google.js";
import { signAppToken } from "../../lib/jwt.js";
import { emitGroup, getIo, userRoom } from "../../lib/realtime.js";
import { lockGroups, regenerate } from "../shopping-list/engine.js";
import { toUser, usersRepo } from "./repo.js";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const usersService = {
  /** POST /auth/google: verify the Google ID token, upsert the user by google_sub, issue our JWT. */
  async signInWithGoogle(idToken: string): Promise<AuthResponse> {
    let identity;
    try {
      identity = await google.verifyIdToken(idToken);
    } catch {
      throw new AppError(401, "UNAUTHENTICATED", "Google sign-in failed");
    }
    if (!identity.emailVerified || !identity.email) {
      throw new AppError(401, "EMAIL_NOT_VERIFIED", "Your Google account email is not verified");
    }
    const email = normalizeEmail(identity.email);
    const displayName = identity.name?.trim() || email.split("@")[0];
    const user = await usersRepo.upsertFromGoogle(prisma, {
      sub: identity.sub,
      email,
      displayName: displayName.slice(0, 80),
      picture: identity.picture ?? null,
    });
    return { token: signAppToken(user.id), user: toUser(user) };
  },

  /** Dev/demo only: a session for an existing (seeded) user. */
  async loginAs(userId: string): Promise<AuthResponse> {
    const user = await usersRepo.findById(prisma, userId);
    if (!user) throw notFound("User");
    return { token: signAppToken(user.id), user: toUser(user) };
  },

  async getMe(userId: string): Promise<User> {
    const user = await usersRepo.findById(prisma, userId);
    if (!user) throw notFound("User");
    return toUser(user);
  },

  async updateMe(userId: string, body: UpdateMeBody): Promise<User> {
    const user = await usersRepo.update(prisma, userId, body);
    return toUser(user);
  },

  /**
   * DELETE /me. One transaction: delete the user (memberships and preferences cascade; the owner_handoff trigger
   * promotes the longest-standing member if they were the last owner), delete groups left with no members,
   * and regenerate the lists of the groups that remain (their preferences changed).
   */
  async deleteMe(userId: string): Promise<void> {
    const remaining = await prisma.$transaction(async (tx) => {
      const groupIds = await usersRepo.groupIds(tx, userId);
      await lockGroups(tx, groupIds);
      await tx.user.delete({ where: { id: userId } });
      await tx.group.deleteMany({ where: { id: { in: groupIds }, members: { none: {} } } });
      const left = (await tx.group.findMany({ where: { id: { in: groupIds } }, select: { id: true } })).map((g) => g.id);
      for (const gid of left) await regenerate(tx, gid);
      return left;
    });
    for (const gid of remaining) {
      emitGroup(gid, "group:changed", userId);
      emitGroup(gid, "preferences:changed", userId);
      emitGroup(gid, "shopping-list:changed", userId);
    }
    getIo()?.in(userRoom(userId)).disconnectSockets(true);
  },
};
