import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { verifyAppToken } from "../lib/jwt.js";
import { logger } from "../lib/logger.js";
import { groupRoom, setIo, userRoom } from "../lib/realtime.js";
import { groupsRepo } from "../modules/groups/repo.js";

const JoinPayload = z.object({ groupId: z.uuid() });
type Ack = (res: { ok: true } | { ok: false; error: { code: string; message: string } }) => void;

/**
 * Socket.IO server (backend/07). Clients connect with `auth: { token: <appJwt> }`, are put in their personal
 * `user:<id>` room, and send `group:join {groupId}` (membership checked like requireGroupMember) / `group:leave {groupId}`.
 * The server only sends "something changed" signals ({groupId, by}); clients refetch over REST.
 */
export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, !origin || config.CORS_ORIGINS.includes(origin) || config.NODE_ENV !== "production"),
    },
  });

  io.use(async (socket, next) => {
    const token = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : "";
    const userId = token ? verifyAppToken(token) : null;
    if (!userId || !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      next(new Error("UNAUTHENTICATED"));
      return;
    }
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    socket.join(userRoom(userId));

    socket.on("group:join", async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === "function" ? ack : () => {};
      try {
        const parsed = JoinPayload.safeParse(payload);
        const member = parsed.success && (await groupsRepo.findMembership(prisma, parsed.data.groupId, userId));
        if (!parsed.success || !member) {
          reply({ ok: false, error: { code: "NOT_FOUND", message: "Group not found" } });
          return;
        }
        await socket.join(groupRoom(parsed.data.groupId));
        reply({ ok: true });
      } catch (err) {
        logger.error({ err }, "group:join failed");
        reply({ ok: false, error: { code: "INTERNAL", message: "Something went wrong" } });
      }
    });

    socket.on("group:leave", async (payload: unknown, ack?: Ack) => {
      const parsed = JoinPayload.safeParse(payload);
      if (parsed.success) await socket.leave(groupRoom(parsed.data.groupId));
      if (typeof ack === "function") ack({ ok: true });
    });
  });

  setIo(io);
  return io;
}
