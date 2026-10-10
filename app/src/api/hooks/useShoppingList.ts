import type { CompleteResult, ShoppingListItem } from '@contracts/models';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveGroupId } from '@/state/ActiveGroupContext';

import { api } from '../client';
import { qk } from '../keys';
import { useMe } from './useMe';

/**
 * useShoppingList(opts?: { refetchInterval?: number | false }): UseQueryResult<ShoppingListItem[]>
 *   GET /groups/:gid/shopping-list, already sorted by the server (aisle order). Do not re-sort.
 * useToggleListItem(): UseMutationResult<ShoppingListItem, ApiError, { id: string; checked: boolean }>
 *   Optimistic PATCH {checked}; rolls back on failure. Retries up to 3× on network/5xx (queryClient default).
 * useSyncingListIds(): Set<string>   // row IDs whose check-off is still in flight (show the "syncing" dot)
 * useAddToList(): UseMutationResult<{ row: ShoppingListItem; alreadyOnList: boolean }, ApiError, { itemId: string }>
 *   Manual add. If the item is already on the cached list, resolves { alreadyOnList: true } without a request.
 * useRemoveListItem(): UseMutationResult<void, ApiError, { id: string }>   // manual rows only
 * useFinishTrip(): UseMutationResult<CompleteResult, ApiError, void>
 *   POST /complete → invalidates list, cabinet, and preferences.
 */

const TOGGLE_KEY = 'toggle-list-item';

export function useShoppingList(opts: { refetchInterval?: number | false } = {}) {
  const gid = useActiveGroupId();
  return useQuery({
    queryKey: qk.list(gid ?? ''),
    queryFn: () => api<ShoppingListItem[]>(`/groups/${gid}/shopping-list`),
    enabled: !!gid,
    refetchInterval: opts.refetchInterval,
  });
}

export function useToggleListItem() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  const meId = useMe().data?.id ?? null;
  return useMutation({
    mutationKey: [TOGGLE_KEY, gid],
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) =>
      api<ShoppingListItem>(`/groups/${gid}/shopping-list/${id}`, { method: 'PATCH', body: { checked } }),
    onMutate: async ({ id, checked }) => {
      await qc.cancelQueries({ queryKey: qk.list(gid) });
      const prev = qc.getQueryData<ShoppingListItem[]>(qk.list(gid));
      qc.setQueryData<ShoppingListItem[]>(qk.list(gid), (old) =>
        old?.map((r) =>
          r.id === id
            ? { ...r, checked, checkedBy: checked ? meId : null, checkedAt: checked ? new Date().toISOString() : null }
            : r,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.list(gid), ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.list(gid) }),
  });
}

export function useSyncingListIds(): Set<string> {
  const gid = useActiveGroupId() ?? '';
  const pending = useMutationState({
    filters: { mutationKey: [TOGGLE_KEY, gid], status: 'pending' },
    select: (m) => (m.state.variables as { id: string } | undefined)?.id,
  });
  return new Set(pending.filter((id): id is string => !!id));
}

export function useAddToList() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  return useMutation({
    mutationFn: async ({ itemId }: { itemId: string }) => {
      const existing = qc.getQueryData<ShoppingListItem[]>(qk.list(gid))?.find((r) => r.itemId === itemId);
      if (existing) return { row: existing, alreadyOnList: true };
      const row = await api<ShoppingListItem>(`/groups/${gid}/shopping-list`, { method: 'POST', body: { itemId } });
      return { row, alreadyOnList: false };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.list(gid) }),
  });
}

export function useRemoveListItem() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api<void>(`/groups/${gid}/shopping-list/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.list(gid) }),
  });
}

export function useFinishTrip() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  return useMutation({
    mutationFn: () => api<CompleteResult>(`/groups/${gid}/shopping-list/complete`, { method: 'POST' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.list(gid) }),
        qc.invalidateQueries({ queryKey: qk.cabinet(gid) }),
        qc.invalidateQueries({ queryKey: qk.prefsAll(gid) }),
      ]),
  });
}
