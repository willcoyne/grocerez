import type { Group } from "@contracts/groups";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useGroups } from "@/api/hooks/groups";
import { useAuth } from "./AuthContext";
import { storage, storageKeys } from "./storage";

export interface ActiveGroupValue {
  /** null while loading or when the user has no group. */
  activeGroupId: string | null;
  activeGroup: Group | null;
  groups: Group[];
  groupsLoading: boolean;
  groupsError: unknown;
  refetchGroups: () => void;
  setActiveGroupId: (id: string) => void;
}

const ActiveGroupContext = createContext<ActiveGroupValue | null>(null);

/**
 * The household the screens show. Saved in secure storage. If the saved id is no longer one of
 * my groups (left, removed, deleted), it falls back to the first group.
 */
export function ActiveGroupProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const signedIn = status === "signedIn";
  const groupsQuery = useGroups(signedIn);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void storage.get(storageKeys.activeGroupId).then((id) => {
      if (!cancelled) setSavedId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === savedId) ?? groups[0] ?? null,
    [groups, savedId],
  );

  const setActiveGroupId = useCallback((id: string) => {
    setSavedId(id);
    void storage.set(storageKeys.activeGroupId, id);
  }, []);

  const { refetch } = groupsQuery;
  const refetchGroups = useCallback(() => void refetch(), [refetch]);

  const value = useMemo<ActiveGroupValue>(
    () => ({
      activeGroupId: activeGroup?.id ?? null,
      activeGroup,
      groups,
      groupsLoading: signedIn && groupsQuery.isPending,
      groupsError: groupsQuery.error,
      refetchGroups,
      setActiveGroupId,
    }),
    [activeGroup, groups, signedIn, groupsQuery.isPending, groupsQuery.error, refetchGroups, setActiveGroupId],
  );
  return <ActiveGroupContext.Provider value={value}>{children}</ActiveGroupContext.Provider>;
}

export function useActiveGroup(): ActiveGroupValue {
  const ctx = useContext(ActiveGroupContext);
  if (!ctx) throw new Error("useActiveGroup must be used inside <ActiveGroupProvider>");
  return ctx;
}

/** For screens that only render inside the tabs (a group always exists there). */
export function useRequiredGroupId(): string {
  const { activeGroupId } = useActiveGroup();
  return activeGroupId ?? "";
}

export const ActiveGroupContextForTests = ActiveGroupContext;
