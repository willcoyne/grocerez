# 07 — Realtime Sync

**Goal:** When one household member changes the list, cabinet, or preferences, everyone else's screen updates within a second.
**Board:** "everyone can collaborate to make the list" (the board doesn't say how; see `GAPS.md` #11)

**Depends on:** 02, 03

## Steps

1. In `index.ts`, create `http.createServer(app)` and attach `new Server(httpServer, { cors: {...} })` (Socket.IO).
2. **Socket auth:** `io.use()` reads `socket.handshake.auth.token`, verifies the app JWT, and sets `socket.data.userId`. Reject the connection if the token is invalid.
   On connect, automatically `socket.join(\`user:${userId}\`)`. This personal room is used to push `invites:changed` when someone invites this user's email (`03`).
3. `group:join {groupId}`: check membership (same query as `requireGroupMember`), then `socket.join(\`group:${groupId}\`)`.
   `group:leave {groupId}` → `socket.leave`.
4. `lib/realtime.ts`: `emitGroup(groupId, event, payload)` and `emitUser(userId, event, payload)` helpers that services call **after** their transaction commits.
   Events: `shopping-list:changed`, `cabinet:changed`, `preferences:changed`, `group:changed`. Payload: `{groupId, by: userId}`.
   **Send "something changed" signals, not data.** The client refetches through REST, which keeps a single source of truth.
5. When a member is removed, call `io.in(\`group:${groupId}\`).fetchSockets()` and make that user's sockets leave the room.
6. **Fallback:** if sockets cause trouble during the hackathon, the app polls `GET /shopping-list` every 5 seconds on the shopping screen (see `frontend/06`).
   The API needs no changes for this.
7. *(If running more than one server instance)* add `@socket.io/redis-adapter`. Not needed for the demo.

## Done when

- [x] Checking an item on phone A updates phone B in under 1 second
- [x] A user who isn't in the group can't join its room
