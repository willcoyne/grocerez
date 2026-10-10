import type { CabinetItem, RanOutResult, ShoppingListItem, StockStatus } from '@contracts/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveGroupId } from '@/state/ActiveGroupContext';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useCabinet(): UseQueryResult<CabinetItem[]>   // GET /groups/:gid/cabinet, server-sorted (aisle order)
 * useAddToCabinet(): UseMutationResult<CabinetItem, ApiError, { itemId: string }>   // POST (upsert, in_stock)
 * useSetCabinetStatus(): UseMutationResult<{ row: CabinetItem; wantedOnList: boolean }, ApiError, { id: string; status: StockStatus }>
 *   PATCH {status}. wantedOnList = after the change, the item is on the list because someone wants it
 *   (use it for "…running low, so it's on the list" vs "Marked … running low").
 * useRanOut(): UseMutationResult<RanOutResult, ApiError, { id: string }>   // POST …/ran-out → { requeued }
 * useRemoveCabinetItem(): UseMutationResult<void, ApiError, { id: string }>
 * All writes invalidate cabinet + list.
 */
export function useCabinet() {
  const gid = useActiveGroupId();
  return useQuery({
    queryKey: qk.cabinet(gid ?? ''),
    queryFn: () => api<CabinetItem[]>(`/groups/${gid}/cabinet`),
    enabled: !!gid,
  });
}

function useInvalidateCabinetAndList() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.cabinet(gid) }),
      qc.invalidateQueries({ queryKey: qk.list(gid) }),
    ]);
}

export function useAddToCabinet() {
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidateCabinetAndList();
  return useMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      api<CabinetItem>(`/groups/${gid}/cabinet`, { method: 'POST', body: { itemId } }),
    onSuccess: invalidate,
  });
}

export function useSetCabinetStatus() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidateCabinetAndList();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StockStatus }) => {
      const row = await api<CabinetItem>(`/groups/${gid}/cabinet/${id}`, { method: 'PATCH', body: { status } });
      const list = await qc.fetchQuery({
        queryKey: qk.list(gid),
        queryFn: () => api<ShoppingListItem[]>(`/groups/${gid}/shopping-list`),
        staleTime: 0,
      });
      const wantedOnList = list.some((r) => r.itemId === row.itemId && r.reason === 'preference');
      return { row, wantedOnList };
    },
    onSuccess: invalidate,
  });
}

export function useRanOut() {
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidateCabinetAndList();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api<RanOutResult>(`/groups/${gid}/cabinet/${id}/ran-out`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRemoveCabinetItem() {
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidateCabinetAndList();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api<void>(`/groups/${gid}/cabinet/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
