import { z } from "zod";
import { isValidTimeZone } from "../lib/expiration.js";

export const GroupRole = z.enum(["owner", "member"]);
export const InviteStatus = z.enum(["pending", "accepted", "declined", "revoked"]);

/** IANA time zone name of the household ("America/Chicago"); defines "today" for expiry alerts and estimates (DB-08). */
export const TimeZone = z.string().trim().max(64).refine(isValidTimeZone, "must be an IANA time zone, e.g. America/Chicago");

export const CreateGroupBody = z.object({ name: z.string().trim().min(1).max(80), timeZone: TimeZone.optional() });
export const UpdateGroupBody = z
  .object({ name: z.string().trim().min(1).max(80).optional(), timeZone: TimeZone.optional() })
  .refine((b) => b.name !== undefined || b.timeZone !== undefined, { message: "Send name and/or timeZone" });
export type CreateGroupBody = z.infer<typeof CreateGroupBody>;
export type UpdateGroupBody = z.infer<typeof UpdateGroupBody>;

export const Group = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The caller's role in this group. */
  role: GroupRole,
  memberCount: z.number().int(),
  /** IANA time zone of the household (default America/Chicago). */
  timeZone: z.string(),
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
