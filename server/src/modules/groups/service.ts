import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import { sendInviteEmail } from "../../lib/email.js";
import { closeGroupRoom, emitGroup, emitUser, kickFromGroup } from "../../lib/realtime.js";
import type { GroupRole } from "@prisma/client";
import type { Group, GroupDetail, Invite, MyInvite } from "../../contracts/groups.js";
import { toUser } from "../users/service.js";
import { groupsRepo } from "./repo.js";

const inviteNotFound = () => new AppError(404, "INVITE_NOT_FOUND", "Invite not found");

const userByEmail = (email: string) => prisma.user.findUnique({ where: { email }, select: { id: true } });
const myEmail = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email;

export const listGroups = (userId: string) => groupsRepo.listForUser(userId);

export const createGroup = (userId: string, name: string) => groupsRepo.create(name, userId);

export async function getGroup(groupId: string, role: GroupRole): Promise<GroupDetail> {
  const [group, rows] = await Promise.all([groupsRepo.get(groupId, role), groupsRepo.members(groupId)]);
  const members = await Promise.all(rows.map(async (r) => {
    const { id, displayName, email, avatarUrl } = await toUser(r.user); // single User mapping (avatar URLs, backend/11)
    return { id, displayName, email, avatarUrl, role: r.role };
  }));
  return { ...group, members };
}

export async function renameGroup(groupId: string, role: GroupRole, name: string, by: string): Promise<Group> {
  await groupsRepo.rename(groupId, name);
  emitGroup(groupId, "group:changed", by);
  return groupsRepo.get(groupId, role);
}

export async function deleteGroup(groupId: string, by: string) {
  await groupsRepo.delete(groupId);
  emitGroup(groupId, "group:changed", by);
  closeGroupRoom(groupId);
}

// --- invites ---

// Same response whether or not the email has an account (no user enumeration).
export async function invite(groupId: string, email: string, by: string): Promise<Invite> {
  if (await groupsRepo.isMemberByEmail(groupId, email)) throw new AppError(409, "ALREADY_MEMBER", "That person is already a member");
  const invite = await groupsRepo.upsertInvite(groupId, email, by);

  const invitee = await userByEmail(email);
  if (invitee) emitUser(invitee.id, "invites:changed");
  emitGroup(groupId, "group:changed", by);

  const [inviter, group] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: by }, select: { displayName: true } }),
    prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } }),
  ]);
  void sendInviteEmail(email, inviter.displayName, group.name);
  return invite;
}

export const listInvites = (groupId: string, all: boolean) => groupsRepo.listInvites(groupId, all);

export async function revokeInvite(groupId: string, inviteId: string, userId: string, role: GroupRole) {
  const invite = await groupsRepo.findInvite(groupId, inviteId);
  if (!invite) throw inviteNotFound();
  if (role !== "owner" && invite.invitedBy !== userId) {
    throw new AppError(403, "FORBIDDEN", "Only the owner or the person who sent the invite can revoke it");
  }
  if (!(await groupsRepo.setInviteStatus({ id: inviteId, groupId }, "pending", "revoked"))) {
    throw new AppError(409, "INVITE_NOT_PENDING", "Only pending invites can be revoked");
  }
  const invitee = await userByEmail(invite.email);
  if (invitee) emitUser(invitee.id, "invites:changed");
  emitGroup(groupId, "group:changed", userId);
}

export async function myInvites(userId: string): Promise<MyInvite[]> {
  return groupsRepo.myInvites(await myEmail(userId));
}

// users.email is Google's verified email (backend/02), so matching on it means only that Google account can accept.
export async function acceptInvite(inviteId: string, userId: string): Promise<Group> {
  const email = await myEmail(userId);
  const group = await prisma.$transaction(async (tx) => {
    const found = await groupsRepo.pendingInviteForEmail(inviteId, email, tx);
    if (!found) throw inviteNotFound();
    await groupsRepo.lock(tx, found.groupId);
    // Re-checked under the lock: a concurrent revoke / member removal wins.
    if (!(await groupsRepo.setInviteStatus({ id: inviteId, email }, "pending", "accepted", tx))) throw inviteNotFound();
    await tx.groupMember.createMany({ data: [{ groupId: found.groupId, userId }], skipDuplicates: true });
    return groupsRepo.get(found.groupId, (await groupsRepo.role(found.groupId, userId, tx))!, tx);
  });
  emitGroup(group.id, "group:changed", userId);
  emitUser(userId, "invites:changed");
  return group;
}

export async function declineInvite(inviteId: string, userId: string) {
  if (!(await groupsRepo.setInviteStatus({ id: inviteId, email: await myEmail(userId) }, "pending", "declined"))) {
    throw inviteNotFound();
  }
  emitUser(userId, "invites:changed");
}

// --- membership ---

async function dropMember(groupId: string, userId: string, by: string, revokeInvite: boolean) {
  const { groupDeleted } = await prisma.$transaction(async (tx) => {
    await groupsRepo.lock(tx, groupId);
    if (revokeInvite) await groupsRepo.revokeByEmail(tx, groupId, await myEmail(userId));
    return groupsRepo.removeMember(tx, groupId, userId);
  });
  await kickFromGroup(groupId, userId);
  if (!groupDeleted) emitGroup(groupId, "group:changed", by);
  emitUser(userId, "group:changed", { groupId, by }); // their own group list changed too
}

export const leaveGroup = (groupId: string, userId: string) => dropMember(groupId, userId, userId, false);

export async function removeMember(groupId: string, targetId: string, ownerId: string) {
  if (targetId === ownerId) throw new AppError(400, "VALIDATION_ERROR", "Use leave to remove yourself");
  if (!(await groupsRepo.role(groupId, targetId))) throw new AppError(404, "NOT_FOUND", "Member not found");
  await dropMember(groupId, targetId, ownerId, true);
}
