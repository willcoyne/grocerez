import { z } from "zod";

export const GroupRole = z.enum(["owner", "member"]);
export const InviteStatus = z.enum(["pending", "accepted", "declined", "revoked"]);

export const CreateGroupBody = z.object({ name: z.string().trim().min(1).max(80) });
export const UpdateGroupBody = CreateGroupBody;
export type CreateGroupBody = z.infer<typeof CreateGroupBody>;

export const Group = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The caller's role in this group. */
  role: GroupRole,
  memberCount: z.number().int(),
  createdAt: z.string(),
});
export type Group = z.infer<typeof Group>;

export const Member = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: GroupRole,
  joinedAt: z.string(),
});
export type Member = z.infer<typeof Member>;

export const GroupDetail = Group.extend({ members: z.array(Member) });
export type GroupDetail = z.infer<typeof GroupDetail>;

/** Validated first, then trimmed + lower-cased (matches the DB CHECK on group_invites.email / users.email). */
export const InviteBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()).transform((e) => e.toLowerCase()),
});
export type InviteBody = z.infer<typeof InviteBody>;

export const InvitesQuery = z.object({ status: z.enum(["pending", "all"]).default("pending") });

export const Invite = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  email: z.string(),
  status: InviteStatus,
  invitedBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
});
export type Invite = z.infer<typeof Invite>;

/** GET /me/invites rows. */
export const MyInvite = Invite.extend({
  group: z.object({ id: z.uuid(), name: z.string(), memberCount: z.number().int() }),
});
export type MyInvite = z.infer<typeof MyInvite>;

export const InviteParams = z.object({ inviteId: z.uuid() });
export const GroupInviteParams = z.object({ groupId: z.uuid(), inviteId: z.uuid() });
export const GroupMemberParams = z.object({ groupId: z.uuid(), userId: z.uuid() });
