// In-process event bus. The socket (real mode) and the mock API (mock mode) both publish the
// server's Socket.IO events here; useRealtimeSync turns them into query invalidations.

export type RealtimeEvent =
  | 'shopping-list:changed'
  | 'cabinet:changed'
  | 'preferences:changed'
  | 'group:changed'
  | 'invites:changed';

export type RealtimePayload = { groupId?: string; by?: string };

type Listener = (event: RealtimeEvent, payload: RealtimePayload) => void;

const listeners = new Set<Listener>();

export const realtimeBus = {
  emit(event: RealtimeEvent, payload: RealtimePayload = {}) {
    for (const l of [...listeners]) l(event, payload);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
