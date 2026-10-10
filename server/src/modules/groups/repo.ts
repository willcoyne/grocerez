import type { Db } from "../../db.js";

const inviteInclude = { inviter: { select: { id: true, displayName: true } } } as const;

/** Every function is scoped by groupId (and userId where relevant). */
export const groupsRepo = {
  findMembership: (db: Db, groupId: string, userId: string) =>
    db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { role: true, joinedAt: true } }),

  create: (db: Db, name: string, ownerId: string) =>
    db.group.create({
      data: { name, createdBy: ownerId, members: { create: { userId: ownerId, role: "owner" } } },
      include: { _count: { select: { members: true } } },
    }),

  listForUser: (db: Db, userId: string) =>
    db.groupMember.findMany({
      where: { userId },
      include: { group: { include: { _count: { select: { members: true } } } } },
      orderBy: { joinedAt: "asc" },
    }),

  getWithMembers: (db: Db, groupId: string) =>
    db.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true, avatarS3Key: true } } },
          orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
        },
        _count: { select: { members: true } },
      },
    }),

  rename: (db: Db, groupId: string, name: string) =>
    db.group.update({ where: { id: groupId }, data: { name }, include: { _count: { select: { members: true } } } }),

  delete: (db: Db, groupId: string) => db.group.delete({ where: { id: groupId } }),

  memberIds: async (db: Db, groupId: string) =>
    (await db.groupMember.findMany({ where: { groupId }, select: { userId: true } })).map((m) => m.userId),

  removeMember: async (db: Db, groupId: string, userId: string) => {
    // Preferences cascade through the (group_id, user_id) FK; the explicit delete documents the rule (backend/03 step 11).
    await db.preference.deleteMany({ where: { groupId, userId } });
    await db.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
  },

  /** Deletes the group if nobody is left; returns true if it was deleted. */
  deleteIfEmpty: async (db: Db, groupId: string) =>
    (await db.group.deleteMany({ where: { id: groupId, members: { none: {} } } })).count > 0,

  addMember: (db: Db, groupId: string, userId: string) =>
    db.groupMember.createMany({ data: [{ groupId, userId, role: "member" }], skipDuplicates: true }),

  // ─── Invites ───
  isMemberByEmail: async (db: Db, groupId: string, email: string) =>
    (await db.groupMember.count({ where: { groupId, user: { email } } })) > 0,

  /** Re-inviting resets the row to pending (one row per (group, email)). */
  upsertInvite: (db: Db, groupId: string, email: string, invitedBy: string) =>
    db.groupInvite.upsert({
      where: { groupId_email: { groupId, email } },
      create: { groupId, email, invitedBy },
      update: { status: "pending", invitedBy, createdAt: new Date(), respondedAt: null },
      include: inviteInclude,
    }),

  listInvites: (db: Db, groupId: string, all: boolean) =>
    db.groupInvite.findMany({
      where: { groupId, ...(all ? {} : { status: "pending" }) },
      include: inviteInclude,
      orderBy: { createdAt: "desc" },
    }),

  findInviteInGroup: (db: Db, groupId: string, inviteId: string) =>
    db.groupInvite.findFirst({ where: { id: inviteId, groupId } }),

  findInvite: (db: Db, inviteId: string) => db.groupInvite.findUnique({ where: { id: inviteId } }),

  setInviteStatus: (db: Db, inviteId: string, status: "accepted" | "declined" | "revoked") =>
    db.groupInvite.update({ where: { id: inviteId }, data: { status, respondedAt: new Date() } }),

  /** Conditional transition: only a pending invite changes (returns 0 if someone else got there first). */
  respondIfPending: async (db: Db, inviteId: string, status: "accepted" | "declined" | "revoked") =>
    (await db.groupInvite.updateMany({ where: { id: inviteId, status: "pending" }, data: { status, respondedAt: new Date() } }))
      .count,

  revokeForEmail: (db: Db, groupId: string, email: string) =>
    db.groupInvite.updateMany({ where: { groupId, email, status: { not: "revoked" } }, data: { status: "revoked", respondedAt: new Date() } }),

  myPendingInvites: (db: Db, email: string) =>
    db.groupInvite.findMany({
      where: { email, status: "pending" },
      include: { ...inviteInclude, group: { include: { _count: { select: { members: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
};
