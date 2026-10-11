import type { AddCabinetBody, CabinetItem, UpdateCabinetBody } from "@contracts/cabinet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../client";
import { keys } from "../keys";

export function useCabinet(groupId: string) {
  return useQuery({
    queryKey: keys.cabinet(groupId),
    queryFn: () => api<CabinetItem[]>(`/groups/${groupId}/cabinet`),
    enabled: !!groupId,
  });
}

/** Cabinet writes can change "have", so the list (and alerts) are stale afterwards. */
function invalidateCabinet(qc: ReturnType<typeof useQueryClient>, groupId: string) {
  void qc.invalidateQueries({ queryKey: keys.cabinet(groupId) });
  void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) });
  void qc.invalidateQueries({ queryKey: keys.alerts(groupId) });
}

export function useAddCabinetItem(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddCabinetBody) => api<CabinetItem>(`/groups/${groupId}/cabinet`, { method: "POST", body }),
    onSettled: () => invalidateCabinet(qc, groupId),
  });
}

export function useUpdateCabinetItem(groupId: string) {
  const qc = useQueryClient();
  const key = keys.cabinet(groupId);
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCabinetBody & { id: string }) =>
      api<CabinetItem>(`/groups/${groupId}/cabinet/${id}`, { method: "PATCH", body }),
    onSuccess: (row) => qc.setQueryData<CabinetItem[]>(key, (old) => old?.map((r) => (r.id === row.id ? row : r))),
    onSettled: () => invalidateCabinet(qc, groupId),
  });
}

/** POST …/ran-out → {requeued}. The row is removed optimistically (the "Undo" snackbar re-adds it). */
export function useRanOut(groupId: string) {
  const qc = useQueryClient();
  const key = keys.cabinet(groupId);
  return useMutation({
    mutationFn: (id: string) => api<{ requeued: boolean }>(`/groups/${groupId}/cabinet/${id}/ran-out`, { method: "POST" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CabinetItem[]>(key);
      qc.setQueryData<CabinetItem[]>(key, (old) => old?.filter((r) => r.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => invalidateCabinet(qc, groupId),
  });
}

export function useDeleteCabinetItem(groupId: string) {
  const qc = useQueryClient();
  const key = keys.cabinet(groupId);
  return useMutation({
    mutationFn: (id: string) => api<void>(`/groups/${groupId}/cabinet/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CabinetItem[]>(key);
      qc.setQueryData<CabinetItem[]>(key, (old) => old?.filter((r) => r.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => invalidateCabinet(qc, groupId),
  });
}
