import { z } from "zod";

export const GroupRole = z.enum(["owner", "member"]);
export const InviteStatus = z.enum(["pending", "accepted", "declined", "revoked"]);

// `role` is the caller's role in the group.
export const Group = z.object({
  id: z.uuid(),
  name: z.string(),
  role: GroupRole,
  memberCount: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Group = z.infer<typeof Group>;

export const Member = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: GroupRole,
});
export const GroupDetail = Group.extend({ members: z.array(Member) });
export type GroupDetail = z.infer<typeof GroupDetail>;

export const Invite = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  email: z.string(),
  status: InviteStatus,
  invitedBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
});
export type Invite = z.infer<typeof Invite>;

export const MyInvite = Invite.extend({
  group: z.object({ id: z.uuid(), name: z.string(), memberCount: z.number().int() }),
});
export type MyInvite = z.infer<typeof MyInvite>;

export const GroupNameBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const CreateInviteBody = z
  .object({ email: z.string().trim().pipe(z.email()).transform((e) => e.toLowerCase()) })
  .strict();
export const InvitesQuery = z.object({ status: z.enum(["pending", "all"]).default("pending") });

export const GroupInviteParams = z.object({ groupId: z.uuid(), inviteId: z.uuid() });
export const GroupMemberParams = z.object({ groupId: z.uuid(), userId: z.uuid() });
export const InviteParams = z.object({ inviteId: z.uuid() });
