import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { keys } from "@/api/keys";
import { config } from "@/config";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";

interface GroupEvent {
  groupId: string;
  by?: string | null;
  /** Only on "agent:changed". */
  runId?: string;
}

const SocketStatusContext = createContext<{ connected: boolean }>({ connected: false });

/** Maps each server event to the queries it makes stale (backend/07). */
export function handleSocketEvent(qc: QueryClient, event: string, payload: GroupEvent | undefined) {
  const groupId = payload?.groupId;
  switch (event) {
    case "shopping-list:changed":
      if (groupId) {
        void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) });
        void qc.invalidateQueries({ queryKey: keys.prices(groupId) });
      }
      break;
    case "cabinet:changed":
      if (groupId) {
        void qc.invalidateQueries({ queryKey: keys.cabinet(groupId) });
        void qc.invalidateQueries({ queryKey: keys.alerts(groupId) });
      }
      break;
    case "preferences:changed":
      if (groupId) void qc.invalidateQueries({ queryKey: keys.preferencesAll(groupId) });
      break;
    case "group:changed":
      if (groupId) void qc.invalidateQueries({ queryKey: keys.group(groupId) });
      void qc.invalidateQueries({ queryKey: keys.groups });
      break;
    case "invites:changed":
      void qc.invalidateQueries({ queryKey: keys.myInvites });
      void qc.invalidateQueries({ queryKey: keys.groups });
      if (groupId) void qc.invalidateQueries({ queryKey: keys.groupInvites(groupId) });
      break;
    case "agent:changed":
      if (groupId) {
        if (payload?.runId) void qc.invalidateQueries({ queryKey: keys.agentRun(groupId, payload.runId) });
        void qc.invalidateQueries({ queryKey: keys.agentRuns(groupId), exact: true });
      }
      break;
  }
}

const EVENTS = [
  "shopping-list:changed",
  "cabinet:changed",
  "preferences:changed",
  "group:changed",
  "invites:changed",
  "agent:changed",
];

/**
 * One Socket.IO connection per session (auth = app JWT). Joins the active group's room and re-joins after
 * reconnecting. Events invalidate the matching TanStack queries; the app then refetches.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { activeGroupId } = useActiveGroup();
  const qc = useQueryClient();
  // Created without connecting (no side effect during render); the effect below connects and cleans up.
  const socket = useMemo<Socket | null>(
    () => (token ? io(config.socketUrl, { auth: { token }, transports: ["websocket"], autoConnect: false }) : null),
    [token],
  );
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    for (const ev of EVENTS) socket.on(ev, (payload: GroupEvent) => handleSocketEvent(qc, ev, payload));
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      onDisconnect();
    };
  }, [socket, qc]);

  useEffect(() => {
    if (!socket || !activeGroupId) return;
    const join = () => socket.emit("group:join", { groupId: activeGroupId }, () => {});
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("group:leave", { groupId: activeGroupId }, () => {});
    };
  }, [socket, activeGroupId]);

  return <SocketStatusContext.Provider value={{ connected }}>{children}</SocketStatusContext.Provider>;
}

/** False when the socket is down: the shopping list then polls every 5 s. */
export function useSocketConnected() {
  return useContext(SocketStatusContext).connected;
}
