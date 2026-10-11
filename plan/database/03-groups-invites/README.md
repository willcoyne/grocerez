# 03 — Groups, Members & Email Invites

**Goal:** Households (groups), their members, and an invite list of email addresses. Only the exact Google account that was invited can join.
**Board:** "user makes group" · "user sends invitation to group to other people via a code/link".
**Changed from the board:** email invites replace the temporary join code (see `GAPS.md` #6).

**Depends on:** 02

## Steps

1. `groups`: `id uuid PK, name text NOT NULL, created_by uuid FK → users, created_at, updated_at`.
2. Enum `group_role`: `owner | member`.
3. `group_members`: `group_id FK → groups ON DELETE CASCADE, user_id FK → users ON DELETE CASCADE,
   role group_role NOT NULL DEFAULT 'member', joined_at timestamptz DEFAULT now(), PK(group_id, user_id)`.
   - Index on `user_id` (for "my groups").
4. Enum `invite_status`: `pending | accepted | declined | revoked`.
5. `group_invites`:
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | group_id | uuid FK → groups ON DELETE CASCADE | |
   | email | text NOT NULL | stored lower-cased and trimmed; CHECK `email = lower(email)` |
   | invited_by | uuid FK → users ON DELETE SET NULL | |
   | status | invite_status NOT NULL DEFAULT 'pending' | |
   | created_at | timestamptz | |
   | responded_at | timestamptz NULL | set on accept / decline / revoke |
   - `UNIQUE (group_id, email)`: one row per person per group. Inviting someone again sets the existing row back to `pending`
     instead of inserting a duplicate, so the table doubles as the group's email history.
   - Index on `(email, status)`, used for "invites waiting for me" when a user signs in.
6. **Matching rule:** an invite belongs to a user when `group_invites.email = users.email`. `users.email` comes from Google's
   *verified* email (`backend/02`) and is refreshed on every login. Only lower-case is applied. Don't strip Gmail dots or `+tags`,
   so the invite must use the address the person actually signs in with.
7. No expiry and no cleanup job are needed. Invites stay pending until accepted, declined, or revoked. Old rows are kept as
   history and deleted along with the group.
8. Migration name: `groups_and_invites`.

## Done when

- [x] A user can belong to multiple groups; `(group_id, user_id)` can't be duplicated
- [x] Inviting the same email twice to one group leaves one row
- [x] Deleting a group cascades its members and invites
