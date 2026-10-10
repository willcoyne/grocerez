import type { Group } from '@contracts/models';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/api/client';
import { qk } from '@/api/keys';

import { useAuth } from './AuthContext';
import { getItem, setItem, storageKeys } from './storage';

/**
 * useActiveGroup(): {
 *   groups: Group[] | undefined      // GET /groups (undefined while loading or signed out)
 *   groupsStatus: 'pending' | 'error' | 'success'
 *   refetchGroups(): void
 *   activeGroupId: string | null     // stored choice if still valid, otherwise the first group
 *   activeGroup: Group | null
 *   setActiveGroupId(id: string): void
 * }
 * useActiveGroupId(): string | null  — shorthand used by every group-scoped hook.
 */
type ActiveGroupState = {
  groups: Group[] | undefined;
  groupsStatus: 'pending' | 'error' | 'success';
  refetchGroups: () => void;
  activeGroupId: string | null;
  activeGroup: Group | null;
  setActiveGroupId: (id: string) => void;
};

const ActiveGroupContext = createContext<ActiveGroupState | null>(null);

export function ActiveGroupProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [chosenId, setChosenId] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: qk.groups(),
    queryFn: () => api<Group[]>('/groups'),
    enabled: !!token,
  });

  // A stale choice (e.g. from a previous session) is harmless: it falls back to the first group below.
  useEffect(() => {
    if (!token) return;
    getItem(storageKeys.activeGroupId).then((id) => id && setChosenId((cur) => cur ?? id));
  }, [token]);

  const setActiveGroupId = useCallback((id: string) => {
    setChosenId(id);
    void setItem(storageKeys.activeGroupId, id);
  }, []);

  const groups = groupsQuery.data;
  const activeGroup = groups?.find((g) => g.id === chosenId) ?? groups?.[0] ?? null;

  const value = useMemo<ActiveGroupState>(
    () => ({
      groups,
      groupsStatus: groupsQuery.status,
      refetchGroups: () => void groupsQuery.refetch(),
      activeGroupId: activeGroup?.id ?? null,
      activeGroup,
      setActiveGroupId,
    }),
    [groups, groupsQuery, activeGroup, setActiveGroupId],
  );
  return <ActiveGroupContext.Provider value={value}>{children}</ActiveGroupContext.Provider>;
}

export function useActiveGroup(): ActiveGroupState {
  const ctx = useContext(ActiveGroupContext);
  if (!ctx) throw new Error('useActiveGroup must be used inside ActiveGroupProvider');
  return ctx;
}

export function useActiveGroupId(): string | null {
  return useActiveGroup().activeGroupId;
}
