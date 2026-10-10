# 03 — Groups & Email Invites

**Goal:** Create households, invite people by email so only the invited Google account can join, and lock every group route to its members.
**Board:** "user makes group" → "user sends invitation to group to other people via a code/link" → "other users make account and join group by link/code".
**Changed from the board:** email invites replace the temporary join code (see `GAPS.md` #6).

**Depends on:** 02, `database/03-groups-invites`, 07 (for the per-user socket room)

## Two separate protections

1. **Who can get in:** only an email on the group's invite list, accepted by the Google account with that verified email.
2. **Who can read a group's data:** `requireGroupMember` on every `/groups/:groupId/*` route. Invites don't replace this check.
   Without it, any signed-in user could change the group ID in a request and read another household.

## Steps

1. `middleware/requireGroupMember.ts`: for any `/groups/:groupId/*` route, look up `group_members (groupId, req.userId)`.
   Return `404 NOT_FOUND` if the caller isn't a member (don't reveal that the group exists). Attach `req.membership.role`.
   Add `requireOwner` for owner-only routes.
2. `POST /groups {name}`: in one transaction, create the group and add the creator as `owner`. Return it.
3. `GET /groups`: the caller's groups, with member count and role.
   `GET /groups/:groupId`: group + members (`id, displayName, email, avatarUrl, role`).
4. `PATCH /groups/:groupId {name}` and `DELETE /groups/:groupId` (owner only).
5. **Invite:** `POST /groups/:groupId/invites {email}` (any member can invite).
   1. Validate with `z.string().email()`, then lower-case and trim.
   2. If that email belongs to someone who's already a member → `409 ALREADY_MEMBER`.
   3. Upsert on `(group_id, email)`: set `status='pending'`, `invited_by`, `created_at=now()`, `responded_at=null`.
   4. **Same response whether or not the email has an account yet.** This prevents using invites to check who uses the app.
   5. If a user with that email exists, send `invites:changed` to their `user:<id>` socket room (see `07`).
   6. Rate-limit to 20 invites per hour per user.
6. **Group's invite list:** `GET /groups/:groupId/invites` (members) returns pending invites with `email`, `invitedBy` name, and `createdAt`.
   Add `?status=all` to include the history.
7. **Revoke:** `DELETE /groups/:groupId/invites/:inviteId`. Allowed for the owner or the person who sent the invite. Only `pending` invites can be revoked.
   Sets `status='revoked'`, `responded_at=now()`.
8. **My invites:** `GET /me/invites` returns pending invites where `email = (SELECT email FROM users WHERE id = req.userId)`,
   with group name, member count, and who invited them.
9. **Accept:** `POST /invites/:inviteId/accept`, in one transaction:
   1. Load the invite. It must be `pending` and its email must equal the caller's email. Otherwise `404 INVITE_NOT_FOUND`.
   2. Insert `group_members (role member)` (do nothing if already a member).
   3. Set `status='accepted'`, `responded_at=now()`. Send `group:changed` to the group room. Return the group.
10. **Decline:** `POST /invites/:inviteId/decline`. Same ownership check. Sets `status='declined'`.
11. **Leave:** `POST /groups/:groupId/leave`, in a transaction: delete the caller's preferences in the group, then the membership.
    If the caller was the last owner, promote the longest-standing member. If they were the last member, delete the group.
12. **Remove member:** `DELETE /groups/:groupId/members/:userId` (owner only, can't remove yourself). Same preference cleanup as leaving.
    Also set that person's invite row to `revoked`, so the old invite can't be accepted again. Re-inviting them is a deliberate new action.
13. **Optional email notification (stretch):** after step 5, send an email with Resend (`RESEND_API_KEY`):
    "Carson invited you to *Hack Midwest House* on GrocerEZ. Sign in with this Google account to accept." Link: `${APP_LINK_BASE}invites`.
    The link holds no secret; the invite only works for the matching signed-in account. Without this step, people see invites when they open the app.
14. Tests: an invite for someone else's email can't be accepted (404); re-inviting doesn't duplicate; a revoked invite can't be accepted;
    the invite response is the same for known and unknown emails; a non-member gets 404 on group routes.

## Done when

- [x] A member invites `will@…`, and Will signs in with that Google account, sees the invite, accepts, and is in the group
- [x] Signing in with any other account never shows or accepts that invite
- [x] The owner sees pending invites and can revoke them
- [x] A non-member can't read any `/groups/:groupId/*` route
