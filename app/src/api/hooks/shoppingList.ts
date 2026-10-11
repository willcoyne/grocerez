import type { AddListItemBody, CheckListItemBody, ShoppingListItem } from "@contracts/shoppingList";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/state/AuthContext";
import { api } from "../client";
import { keys } from "../keys";

export function useShoppingList(groupId: string, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: keys.shoppingList(groupId),
    queryFn: () => api<ShoppingListItem[]>(`/groups/${groupId}/shopping-list`),
    enabled: !!groupId,
    refetchInterval: opts.refetchInterval,
  });
}


/**
 * Check-off: optimistic toggle → PATCH {checked, scannedProductId?}. Retries (3, from the client defaults) and pauses
 * while offline; on final failure the row is rolled back. Each row has its own mutation key so the row can show "syncing".
 */
export function useCheckItem(groupId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = keys.shoppingList(groupId);
  return useMutation({
    mutationKey: ["check", groupId],
    mutationFn: ({ id, ...body }: CheckListItemBody & { id: string }) =>
      api<ShoppingListItem>(`/groups/${groupId}/shopping-list/${id}`, { method: "PATCH", body }),
    onMutate: async ({ id, checked, scannedProductId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ShoppingListItem[]>(key);
      qc.setQueryData<ShoppingListItem[]>(key, (old) =>
        old?.map((r) =>
          r.id === id
            ? {
                ...r,
                checked,
                checkedBy: checked ? (user?.id ?? null) : null,
                checkedAt: checked ? new Date().toISOString() : null,
                scannedProductId: scannedProductId === undefined ? r.scannedProductId : scannedProductId,
              }
            : r,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (row) => qc.setQueryData<ShoppingListItem[]>(key, (old) => old?.map((r) => (r.id === row.id ? row : r))),
    onSettled: () => {
      // Only refetch once no other check-off is still in flight, so a stale response can't undo a newer tap.
      if (qc.isMutating({ mutationKey: ["check", groupId] }) <= 1) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Manual add ("we're out of X"). */
export function useAddListItem(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddListItemBody) => api<ShoppingListItem>(`/groups/${groupId}/shopping-list`, { method: "POST", body }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) });
      void qc.invalidateQueries({ queryKey: keys.prices(groupId) });
    },
  });
}

export function useDeleteListItem(groupId: string) {
  const qc = useQueryClient();
  const key = keys.shoppingList(groupId);
  return useMutation({
    mutationFn: (id: string) => api<void>(`/groups/${groupId}/shopping-list/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ShoppingListItem[]>(key);
      qc.setQueryData<ShoppingListItem[]>(key, (old) => old?.filter((r) => r.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

/** Finish trip: one server transaction moves checked rows into the cabinet. Not retried automatically. */
export function useCompleteTrip(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ movedToCabinet: number }>(`/groups/${groupId}/shopping-list/complete`, { method: "POST" }),
    retry: false,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) });
      void qc.invalidateQueries({ queryKey: keys.cabinet(groupId) });
      void qc.invalidateQueries({ queryKey: keys.alerts(groupId) });
      void qc.invalidateQueries({ queryKey: keys.preferencesAll(groupId) });
    },
  });
}
