import type { Db } from "../../db.js";
import type { User as UserRow } from "../../../generated/prisma/client.js";
import type { User } from "../../contracts/auth.js";
import { images } from "../../lib/images.js";

/** avatarUrl = presigned S3 avatar if uploaded (11), else the Google picture. */
export async function toUser(u: UserRow): Promise<User> {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: (await images.urlFor(u.avatarS3Key)) ?? u.avatarUrl,
    zipCode: u.zipCode,
    createdAt: u.createdAt.toISOString(),
  };
}

export const usersRepo = {
  findById: (db: Db, id: string) => db.user.findUnique({ where: { id } }),

  /** Upsert by Google's stable `sub`. Email + picture refresh on every login; displayName only on create. */
  upsertFromGoogle: (db: Db, g: { sub: string; email: string; displayName: string; picture: string | null }) =>
    db.user.upsert({
      where: { googleSub: g.sub },
      create: { googleSub: g.sub, email: g.email, displayName: g.displayName, avatarUrl: g.picture },
      update: { email: g.email, avatarUrl: g.picture },
    }),

  update: (db: Db, id: string, data: { displayName?: string; zipCode?: string | null; avatarS3Key?: string | null }) =>
    db.user.update({ where: { id }, data }),

  groupIds: async (db: Db, userId: string) =>
    (await db.groupMember.findMany({ where: { userId }, select: { groupId: true } })).map((m) => m.groupId),
};
