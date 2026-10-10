import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { userIdFromToken } from "../middleware/auth.js";
import { groupsRepo } from "../modules/groups/repo.js";

// "Something changed" signals only; clients refetch through REST (backend/07 step 4).
export type GroupEvent = "shopping-list:changed" | "cabinet:changed" | "preferences:changed" | "group:changed";
export type UserEvent = "invites:changed" | "group:changed";

let io: Server | null = null;

// Postgres compares uuids case-insensitively, so room names must be canonical (lower case) or rooms split.
const room = (groupId: string) => `group:${groupId.toLowerCase()}`;

const JoinBody = z.object({ groupId: z.uuid() });
type Ack = (res: { ok: boolean }) => void;

export function attachRealtime(server: HttpServer, corsOrigins: string[]): Server {
  io = new Server(server, { cors: { origin: corsOrigins } });

  io.use(async (socket, next) => {
    const userId = await userIdFromToken(socket.handshake.auth?.token).catch(() => null);
    if (!userId) return next(new Error("UNAUTHENTICATED"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);

    socket.on("group:join", async (body: unknown, ack?: Ack) => {
      const parsed = JoinBody.safeParse(body);
      const ok = parsed.success && (await groupsRepo.role(parsed.data.groupId, userId).catch(() => null)) !== null;
      if (ok) socket.join(room(parsed.data.groupId));
      if (typeof ack === "function") ack({ ok });
    });

    socket.on("group:leave", (body: unknown, ack?: Ack) => {
      const parsed = JoinBody.safeParse(body);
      if (parsed.success) socket.leave(room(parsed.data.groupId));
      if (typeof ack === "function") ack({ ok: parsed.success });
    });
  });

  return io;
}

// Call these only after the transaction has committed. No-ops when Socket.IO isn't attached (REST-only tests).
export function emitGroup(groupId: string, event: GroupEvent, by: string) {
  io?.to(room(groupId)).emit(event, { groupId: groupId.toLowerCase(), by });
}

export function emitUser(userId: string, event: UserEvent, payload: object = {}) {
  io?.to(`user:${userId}`).emit(event, payload);
}

// Removed/left members stop receiving the group's events (backend/07 step 5).
export async function kickFromGroup(groupId: string, userId: string) {
  if (!io) return;
  const r = room(groupId);
  for (const s of await io.in(r).fetchSockets()) if (s.data.userId === userId) s.leave(r);
}

// Deleted group: empty the room.
export function closeGroupRoom(groupId: string) {
  io?.in(room(groupId)).socketsLeave(room(groupId));
}
