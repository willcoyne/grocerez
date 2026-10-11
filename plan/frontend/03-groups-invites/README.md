# 03 — Groups & Invites

**Goal:** Create a household, invite people by email, accept or decline invites, manage who's in the group, and switch between groups.
**Board:** "user makes group" → "user sends invitation to group to other people via a code/link" → "other users make account and join group by link/code".
**Changed from the board:** email invites replace the join code (see `GAPS.md` #6).

**Depends on:** 02, `backend/03-groups-invites`, `backend/07-realtime-sync`

## Steps

1. **NoGroup screen** (signed in, not in any group):
   - **Pending invites** at the top (`GET /me/invites`): cards showing "Carson invited you to *Hack Midwest House* · 3 members" with [Accept] / [Decline].
   - "Create a household" button.
   - If there are no invites: "Waiting to join someone? Ask them to invite **you@gmail.com**." Show the user's email, with a copy button.
2. **Create:** name input → `POST /groups` → set it as the active group → go straight to the Invite sheet.
3. **Invite sheet** (also opened from the Group tab):
   - Email input (email keyboard, no autocapitalize) → `POST /groups/:id/invites`.
     Success toast: "Invited will@…. They'll see it when they sign in with that Google account."
     `409 ALREADY_MEMBER` → "They're already in this household."
   - Optional "Tell them" button → `Share.share({ message: "I invited you to our GrocerEZ household. Sign in with will@… to accept." })`.
     The message contains no code or secret.
   - **Pending invites** list under the input (`GET /groups/:id/invites`): email, "invited by Ian · 2h ago", and a [Revoke] swipe action
     (shown only to the owner and the person who sent it).
4. **Invites everywhere else:**
   - After sign-in, and whenever the app returns to the foreground, fetch `GET /me/invites`. If any exist, show a banner on the tabs
     ("You've been invited to *X*") that opens the invites screen.
   - Socket `invites:changed` (per-user room) → refetch, so an invite appears live if the person already has the app open.
   - Deep link `grocerez://invites` (used by the optional email) → invites screen. No code in the link.
   - Accept → `POST /invites/:id/accept` → refresh groups → make it the active group → go to tabs.
5. **ActiveGroupContext:** `activeGroupId` saved in secure storage. A group switcher in the header (dropdown of `GET /groups`) for users in several households.
6. **Group tab:** member list (avatar, name, email, role, and allergen chips so everyone knows the household's allergies), Invite button,
   pending invites, Leave group (with confirmation), Remove member (owner only, swipe action), Rename/Delete (owner only).
7. **Realtime:** on active-group change, `socket.emit("group:join", {groupId})`. A `group:changed` event invalidates `["group", id]`
   (a new member appears for everyone when an invite is accepted).

## Done when

- [ ] Phone A creates a group and invites B's email; B signs in, sees the invite, accepts; A sees B in the member list without refreshing — **needs device check** (socket `group:changed` → invalidation is unit-tested)
- [ ] Signing in with an account that wasn't invited shows no invite — server-side rule; the app shows whatever `GET /me/invites` returns. **Needs device check**
- [ ] Revoking a pending invite removes it from B's invites screen — `invites:changed` → refetch of `["me","invites"]` is unit-tested; **needs device check**

## Status (2026-10-10)

Built: NoGroup, Create, Invite sheet (`/invite`, Share message without codes), my invites (`/invites`, also `grocerez://invites`),
invite banner on the tabs (refetch on foreground), header group switcher, Group tab (members, pending invites, rename/leave/delete),
socket room join per active group. Jest: group switching + stale saved id fallback, 409 ALREADY_MEMBER message, accept → active group.
Member allergen chips need a backend field (see DECISIONS "Needs backend change").
