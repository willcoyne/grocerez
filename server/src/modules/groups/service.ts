import { prisma } from "../../db.js";
import type { Group, GroupDetail, Invite, MyInvite } from "../../contracts/groups.js";
import { sendInviteEmail } from "../../lib/email.js";
import { images } from "../../lib/images.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { emitGroup, emitUser, evictFromGroupRoom } from "../../lib/realtime.js";
import { lockGroup, regenerate } from "../shopping-list/engine.js";
import { groupsRepo } from "./repo.js";

type GroupRow = { id: string; name: string; timeZone: string; createdAt: Date; _count: { members: number } };
type InviteRow = {
  id: string; groupId: string; email: string; status: Invite["status"]; createdAt: Date; respondedAt: Date | null;
  inviter: { id: string; displayName: string } | null;
};

const toGroup = (g: GroupRow, role: Group["role"]): Group => ({
  id: g.id, name: g.name, role, memberCount: g._count.members, timeZone: g.timeZone, createdAt: g.createdAt.toISOString(),
});

const toInvite = (i: InviteRow): Invite => ({
  id: i.id,
  groupId: i.groupId,
  email: i.email,
  status: i.status,
  invitedBy: i.inviter ? { id: i.inviter.id, displayName: i.inviter.displayName } : null,
  createdAt: i.createdAt.toISOString(),
  respondedAt: i.respondedAt?.toISOString() ?? null,
});

const inviteNotFound = () => new AppError(404, "INVITE_NOT_FOUND", "Invite not found");

async function callerEmail(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!u) throw new AppError(401, "UNAUTHENTICATED", "Sign in required");
  return u.email;
}

/** After a member leaves/is removed: tell the group, refresh the removed user's group list, drop their sockets. */
async function afterMemberGone(groupId: string, userId: string, by: string, groupDeleted: boolean) {
  if (!groupDeleted) {
    emitGroup(groupId, "group:changed", by);
    emitGroup(groupId, "preferences:changed", by);
    emitGroup(groupId, "shopping-list:changed", by);
  }
  emitUser(userId, "group:changed", { groupId, by });
  await evictFromGroupRoom(groupId, userId);
}

export const groupsService = {
  async create(userId: string, name: string, timeZone?: string): Promise<Group> {
    const g = await prisma.$transaction((tx) => groupsRepo.create(tx, name, userId, timeZone));
    return toGroup(g, "owner");
  },

  async list(userId: string): Promise<Group[]> {
    const rows = await groupsRepo.listForUser(prisma, userId);
    return rows.map((m) => toGroup(m.group, m.role));
  },

  async get(groupId: string, role: Group["role"]): Promise<GroupDetail> {
    const g = await groupsRepo.getWithMembers(prisma, groupId);
    if (!g) throw notFound("Group");
    return {
      ...toGroup(g, role),
      members: await Promise.all(
        g.members.map(async (m) => ({
          id: m.user.id,
          displayName: m.user.displayName,
          email: m.user.email,
          avatarUrl: (await images.urlFor(m.user.avatarS3Key)) ?? m.user.avatarUrl,
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
        })),
      ),
    };
  },

  /** PATCH /groups/:groupId {name?, timeZone?} (owner only). */
  async rename(groupId: string, data: { name?: string; timeZone?: string }, by: string): Promise<Group> {
    const g = await groupsRepo.rename(prisma, groupId, data);
    emitGroup(groupId, "group:changed", by);
    return toGroup(g, "owner");
  },

  async remove(groupId: string, by: string): Promise<void> {
    const memberIds = await groupsRepo.memberIds(prisma, groupId);
    await groupsRepo.delete(prisma, groupId);
    emitGroup(groupId, "group:changed", by);
    for (const id of memberIds) emitUser(id, "group:changed", { groupId, by });
    await evictFromGroupRoom(groupId);
  },

  // ─── Invites ─────────────────────────────────────────────────────────────────

  /**
   * Any member can invite. The response is identical whether or not the email has an account
   * (no account-enumeration through invites).
   */
  async invite(groupId: string, inviterId: string, email: string): Promise<Invite> {
    const { invite, inviteeId, inviterName, groupName } = await prisma.$transaction(async (tx) => {
      if (await groupsRepo.isMemberByEmail(tx, groupId, email)) {
        throw conflict("That person is already a member of this group", "ALREADY_MEMBER");
      }
      const invite = await groupsRepo.upsertInvite(tx, groupId, email, inviterId);
      const invitee = await tx.user.findUnique({ where: { email }, select: { id: true } });
      const group = await tx.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
      return { invite, inviteeId: invitee?.id ?? null, inviterName: invite.inviter?.displayName ?? "Someone", groupName: group.name };
    });
    if (inviteeId) emitUser(inviteeId, "invites:changed", { groupId });
    sendInviteEmail(email, inviterName, groupName);
    return toInvite(invite);
  },

  async listInvites(groupId: string, all: boolean): Promise<Invite[]> {
    return (await groupsRepo.listInvites(prisma, groupId, all)).map(toInvite);
  },

  /** Owner or the person who sent it; pending invites only. */
  async revokeInvite(groupId: string, inviteId: string, userId: string, role: Group["role"]): Promise<void> {
    const invite = await groupsRepo.findInviteInGroup(prisma, groupId, inviteId);
    if (!invite) throw inviteNotFound();
    if (role !== "owner" && invite.invitedBy !== userId) throw forbidden("Only the owner or the inviter can revoke this invite");
    if (invite.status !== "pending") throw conflict("Only pending invites can be revoked", "INVITE_NOT_PENDING");
    const changed = await groupsRepo.respondIfPending(prisma, inviteId, "revoked");
    if (!changed) throw conflict("Only pending invites can be revoked", "INVITE_NOT_PENDING");
    const invitee = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (invitee) emitUser(invitee.id, "invites:changed", { groupId });
  },

  async myInvites(userId: string): Promise<MyInvite[]> {
    const email = await callerEmail(userId);
    const rows = await groupsRepo.myPendingInvites(prisma, email);
    return rows.map((r) => ({
      ...toInvite(r),
      group: { id: r.group.id, name: r.group.name, memberCount: r.group._count.members },
    }));
  },

  /** Only the Google-verified email the invite was sent to can accept. Anything else: 404 INVITE_NOT_FOUND. */
  async accept(inviteId: string, userId: string): Promise<Group> {
    const email = await callerEmail(userId);
    const group = await prisma.$transaction(async (tx) => {
      const invite = await groupsRepo.findInvite(tx, inviteId);
      if (!invite || invite.status !== "pending" || invite.email !== email) throw inviteNotFound();
      await lockGroup(tx, invite.groupId);
      await groupsRepo.addMember(tx, invite.groupId, userId);
      if (!(await groupsRepo.respondIfPending(tx, inviteId, "accepted"))) throw inviteNotFound();
      // The new member's allergens change the list's allergen flags.
      await regenerate(tx, invite.groupId);
      const membership = await groupsRepo.findMembership(tx, invite.groupId, userId);
      const g = await tx.group.findUniqueOrThrow({
        where: { id: invite.groupId },
        include: { _count: { select: { members: true } } },
      });
      return toGroup(g, membership?.role ?? "member");
    });
    emitGroup(group.id, "group:changed", userId);
    emitGroup(group.id, "shopping-list:changed", userId);
    emitUser(userId, "invites:changed", { groupId: group.id });
    return group;
  },

  async decline(inviteId: string, userId: string): Promise<void> {
    const email = await callerEmail(userId);
    const invite = await groupsRepo.findInvite(prisma, inviteId);
    if (!invite || invite.status !== "pending" || invite.email !== email) throw inviteNotFound();
    if (!(await groupsRepo.respondIfPending(prisma, inviteId, "declined"))) throw inviteNotFound();
    emitUser(userId, "invites:changed", { groupId: invite.groupId });
  },

  /**
   * Leave: delete my preferences in the group, then my membership (one transaction). The owner_handoff trigger
   * promotes the longest-standing member if I was the last owner; if nobody is left, the group is deleted.
   */
  async leave(groupId: string, userId: string): Promise<void> {
    const deleted = await prisma.$transaction(async (tx) => {
      await lockGroup(tx, groupId);
      await groupsRepo.removeMember(tx, groupId, userId);
      const gone = await groupsRepo.deleteIfEmpty(tx, groupId);
      if (!gone) await regenerate(tx, groupId);
      return gone;
    });
    await afterMemberGone(groupId, userId, userId, deleted);
  },

  /** Owner only, not yourself. Same cleanup as leave, and their invite row is revoked so it can't be re-accepted. */
  async removeMember(groupId: string, ownerId: string, targetId: string): Promise<void> {
    if (targetId === ownerId) throw badRequest("Use leave to remove yourself", "CANNOT_REMOVE_SELF");
    await prisma.$transaction(async (tx) => {
      await lockGroup(tx, groupId);
      const target = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: targetId } },
        include: { user: { select: { email: true } } },
      });
      if (!target) throw notFound("Member");
      await groupsRepo.removeMember(tx, groupId, targetId);
      await groupsRepo.revokeForEmail(tx, groupId, target.user.email);
      await regenerate(tx, groupId);
    });
    await afterMemberGone(groupId, targetId, ownerId, false);
    emitUser(targetId, "invites:changed", { groupId });
  },
};
