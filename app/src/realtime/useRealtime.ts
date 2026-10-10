import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';

import { qk } from '@/api/keys';
import { config, isMockApi } from '@/config';
import { useActiveGroupId } from '@/state/ActiveGroupContext';
import { useAuth } from '@/state/AuthContext';

import { realtimeBus, type RealtimeEvent } from './bus';

/**
 * <RealtimeSync />   mount once inside the providers. Connects the socket (real mode), joins the active
 *                    group's room, and invalidates queries for every event (DESIGN.md §6.2).
 * useSocketConnected(): boolean   // always true in mock mode. When false, screens poll (refetchInterval 5000).
 */

const EVENTS: RealtimeEvent[] = [
  'shopping-list:changed',
  'cabinet:changed',
  'preferences:changed',
  'group:changed',
  'invites:changed',
];

let connected = isMockApi();
const connectionListeners = new Set<() => void>();
function setConnected(next: boolean) {
  if (next === connected) return;
  connected = next;
  for (const l of connectionListeners) l();
}

export function useSocketConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      connectionListeners.add(cb);
      return () => connectionListeners.delete(cb);
    },
    () => connected || isMockApi(),
  );
}

export function RealtimeSync(): null {
  const qc = useQueryClient();
  const { token } = useAuth();
  const gid = useActiveGroupId();

  // Bus → query invalidation (both modes).
  useEffect(
    () =>
      realtimeBus.subscribe((event, payload) => {
        const g = payload.groupId ?? gid;
        const inv = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });
        switch (event) {
          case 'shopping-list:changed':
            if (g) inv(qk.list(g));
            break;
          case 'cabinet:changed':
            if (g) {
              inv(qk.cabinet(g));
              inv(qk.list(g));
            }
            break;
          case 'preferences:changed':
            if (g) {
              inv(qk.prefsAll(g));
              inv(qk.list(g));
            }
            break;
          case 'group:changed':
            if (g) inv(qk.group(g));
            inv(qk.groups());
            break;
          case 'invites:changed':
            inv(qk.myInvites());
            if (g) inv(qk.invites(g));
            break;
        }
      }),
    [qc, gid],
  );

  // Real mode: socket → bus.
  useEffect(() => {
    if (isMockApi() || !token) return;
    const origin = config.apiUrl.replace(/\/api$/, '');
    const socket: Socket = io(origin, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      setConnected(true);
      if (gid) socket.emit('group:join', { groupId: gid });
    });
    socket.on('disconnect', () => setConnected(false));
    for (const event of EVENTS) socket.on(event, (payload) => realtimeBus.emit(event, payload ?? {}));
    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [token, gid]);

  return null;
}
