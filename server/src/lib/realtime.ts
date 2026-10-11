import type { Server } from "socket.io";

export type GroupEvent =
  | "shopping-list:changed"
  | "cabinet:changed"
  | "preferences:changed"
  | "group:changed"
  | "agent:changed"
  | "meal-plan:changed";
export type UserEvent = "invites:changed" | "group:changed";

let io: Server | null = null;

/** Called once by index.ts (or a test) after creating the Socket.IO server. */
export function setIo(server: Server | null) {
  io = server;
}
export function getIo(): Server | null {
  return io;
}

export const groupRoom = (groupId: string) => `group:${groupId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * "Something changed" signals, never data: clients refetch through REST.
 * Call these only AFTER the transaction that made the change has committed.
 */
export function emitGroup(groupId: string, event: GroupEvent, by: string | null, extra: Record<string, string> = {}) {
  io?.to(groupRoom(groupId)).emit(event, { ...extra, groupId, by });
  for (const l of groupListeners) {
    try {
      l(groupId, event);
    } catch {
      // a listener's failure never breaks the request that changed something
    }
  }
}

type GroupListener = (groupId: string, event: GroupEvent) => void;
const groupListeners = new Set<GroupListener>();

/** In-process hook on every group event (e.g. warm the price cache when a list changes). Returns an unsubscribe. */
export function onGroupEvent(listener: GroupListener): () => void {
  groupListeners.add(listener);
  return () => {
    groupListeners.delete(listener);
  };
}

export function emitUser(userId: string, event: UserEvent, payload: Record<string, unknown> = {}) {
  io?.to(userRoom(userId)).emit(event, payload);
}

/** Makes every socket of `userId` leave the group's room (member removed / left / group deleted). */
export async function evictFromGroupRoom(groupId: string, userId?: string) {
  if (!io) return;
  const sockets = await io.in(groupRoom(groupId)).fetchSockets();
  for (const s of sockets) {
    if (!userId || s.data.userId === userId) s.leave(groupRoom(groupId));
  }
}
