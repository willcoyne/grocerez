import { Prisma, type GroupRole, type InviteStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import type { Group, Invite, MyInvite } from "../../contracts/groups.js";

type Db = Prisma.TransactionClient | typeof prisma;

const groupSelect = { id: true, name: true, createdAt: true, _count: { select: { members: true } } } as const;
type GroupRow = Prisma.GroupGetPayload<{ select: typeof groupSelect }>;
const toGroup = (g: GroupRow, role: GroupRole): Group => ({
  id: g.id,
  name: g.name,
  role,
  memberCount: g._count.members,
  createdAt: g.createdAt.toISOString(),
});

const inviteSelect = {
  id: true,
  groupId: true,
  email: true,
  status: true,
  createdAt: true,
  respondedAt: true,
  inviter: { select: { id: true, displayName: true } },
} as const;
type InviteRow = Prisma.GroupInviteGetPayload<{ select: typeof inviteSelect }>;
const toInvite = (i: InviteRow): Invite => ({
  id: i.id,
  groupId: i.groupId,
  email: i.email,
  status: i.status,
  invitedBy: i.inviter,
  createdAt: i.createdAt.toISOString(),
  respondedAt: i.respondedAt?.toISOString() ?? null,
});

export const groupsRepo = {
  // The membership check behind requireGroupMember and group:join. null = not a member.
  role: async (groupId: string, userId: string, db: Db = prisma): Promise<GroupRole | null> =>
    (await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { role: true } }))?.role ?? null,

  // Serializes membership changes per group (last-owner handover, accept vs. remove races).
  lock: (db: Prisma.TransactionClient, groupId: string) =>
    db.$queryRaw`SELECT id FROM groups WHERE id = ${groupId}::uuid FOR UPDATE`,

  listForUser: async (userId: string): Promise<Group[]> => {
    const rows = await prisma.groupMember.findMany({
      where: { userId },
      orderBy: { joinedAt: "asc" },
      select: { role: true, group: { select: groupSelect } },
    });
    return rows.map((r) => toGroup(r.group, r.role));
  },

  get: async (groupId: string, role: GroupRole, db: Db = prisma): Promise<Group> =>
    toGroup(await db.group.findUniqueOrThrow({ where: { id: groupId }, select: groupSelect }), role),

  members: (groupId: string) =>
    prisma.groupMember.findMany({
      where: { groupId },
      orderBy: { joinedAt: "asc" },
      select: { role: true, user: { select: { id: true, displayName: true, email: true, avatarUrl: true, zipCode: true } } },
    }),

  create: (name: string, userId: string) =>
    prisma.group.create({
      data: { name, createdBy: userId, members: { create: { userId, role: "owner" } } },
      select: groupSelect,
    }).then((g) => toGroup(g, "owner")),

  rename: (groupId: string, name: string) => prisma.group.update({ where: { id: groupId }, data: { name } }),

  delete: (groupId: string) => prisma.group.delete({ where: { id: groupId } }),

  // Removes one membership. Promotes the longest-standing member if the last owner left,
  // deletes the group if nobody is left. Caller holds the group lock.
  // Per-group rows (preferences, backend/04) must cascade from group_members so they go with the membership.
  removeMember: async (db: Prisma.TransactionClient, groupId: string, userId: string): Promise<{ groupDeleted: boolean }> => {
    const { count } = await db.groupMember.deleteMany({ where: { groupId, userId } });
    if (!count) return { groupDeleted: false };
    if (await db.groupMember.count({ where: { groupId, role: "owner" } })) return { groupDeleted: false };
    const next = await db.groupMember.findFirst({ where: { groupId }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }] });
    if (!next) {
      await db.group.delete({ where: { id: groupId } });
      return { groupDeleted: true };
    }
    await db.groupMember.update({ where: { groupId_userId: { groupId, userId: next.userId } }, data: { role: "owner" } });
    return { groupDeleted: false };
  },

  groupIdsForUser: async (userId: string, db: Db = prisma) =>
    (await db.groupMember.findMany({ where: { userId }, select: { groupId: true } })).map((m) => m.groupId),

  // --- invites ---

  isMemberByEmail: async (groupId: string, email: string) =>
    (await prisma.groupMember.count({ where: { groupId, user: { email } } })) > 0,

  upsertInvite: async (groupId: string, email: string, invitedBy: string): Promise<Invite> =>
    toInvite(
      await prisma.groupInvite.upsert({
        where: { groupId_email: { groupId, email } },
        create: { groupId, email, invitedBy },
        update: { status: "pending", invitedBy, createdAt: new Date(), respondedAt: null },
        select: inviteSelect,
      }),
    ),

  listInvites: async (groupId: string, all: boolean): Promise<Invite[]> =>
    (
      await prisma.groupInvite.findMany({
        where: { groupId, ...(all ? {} : { status: "pending" }) },
        orderBy: { createdAt: "desc" },
        select: inviteSelect,
      })
    ).map(toInvite),

  findInvite: (groupId: string, inviteId: string) =>
    prisma.groupInvite.findFirst({ where: { id: inviteId, groupId }, select: { email: true, status: true, invitedBy: true } }),

  // Conditional update: only changes a row that is still in `from` status (and matches `email` if given).
  // Returns false if nothing matched, which makes concurrent accept/revoke/decline safe.
  setInviteStatus: async (
    where: { id: string; groupId?: string; email?: string },
    from: InviteStatus,
    to: InviteStatus,
    db: Db = prisma,
  ) => (await db.groupInvite.updateMany({ where: { ...where, status: from }, data: { status: to, respondedAt: new Date() } })).count > 0,

  revokeByEmail: (db: Prisma.TransactionClient, groupId: string, email: string) =>
    db.groupInvite.updateMany({ where: { groupId, email, status: { not: "revoked" } }, data: { status: "revoked", respondedAt: new Date() } }),

  pendingInviteForEmail: (inviteId: string, email: string, db: Db = prisma) =>
    db.groupInvite.findFirst({ where: { id: inviteId, email, status: "pending" }, select: { groupId: true } }),

  myInvites: async (email: string): Promise<MyInvite[]> =>
    (
      await prisma.groupInvite.findMany({
        where: { email, status: "pending" },
        orderBy: { createdAt: "desc" },
        select: { ...inviteSelect, group: { select: groupSelect } },
      })
    ).map(({ group, ...i }) => ({
      ...toInvite(i),
      group: { id: group.id, name: group.name, memberCount: group._count.members },
    })),
};
