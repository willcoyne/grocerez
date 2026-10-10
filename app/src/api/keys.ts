// Query-key factory. Everything group-scoped starts with ['group', gid] so switching groups never
// shows another group's data, and invalidating a group prefix refreshes all of it.

export type PrefScope = 'me' | 'all';

export const qk = {
  me: () => ['me'] as const,
  dietary: () => ['me', 'dietary'] as const,
  myInvites: () => ['me', 'invites'] as const,
  groups: () => ['groups'] as const,
  groupAll: (gid: string) => ['group', gid] as const,
  group: (gid: string) => ['group', gid, 'detail'] as const,
  invites: (gid: string) => ['group', gid, 'invites'] as const,
  list: (gid: string) => ['group', gid, 'shopping-list'] as const,
  cabinet: (gid: string) => ['group', gid, 'cabinet'] as const,
  /** Prefix covering both scopes, for invalidation. */
  prefsAll: (gid: string) => ['group', gid, 'preferences'] as const,
  prefs: (gid: string, scope: PrefScope) => ['group', gid, 'preferences', scope] as const,
  itemSearch: (q: string) => ['items', 'search', q] as const,
};
