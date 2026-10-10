import type { Item } from "@contracts/items";
import type { CreatePreferenceBody, Preference, UpdatePreferenceBody } from "@contracts/preferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/state/AuthContext";
import { api } from "../client";
import { keys } from "../keys";

export function usePreferences(groupId: string, userId: "me" | "all" = "me") {
  return useQuery({
    queryKey: keys.preferences(groupId, userId),
    queryFn: () => api<Preference[]>(`/groups/${groupId}/preferences`, { query: { userId } }),
    enabled: !!groupId,
  });
}

/** The server regenerated the list after every preference write. */
function invalidateAfterWrite(qc: ReturnType<typeof useQueryClient>, groupId: string) {
  void qc.invalidateQueries({ queryKey: keys.preferencesAll(groupId) });
  void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) });
}

/** Optimistic add: the row appears immediately (with a temporary id) and is rolled back if the request fails. */
export function useAddPreference(groupId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = keys.preferences(groupId, "me");
  return useMutation({
    mutationFn: (input: CreatePreferenceBody & { item: Item }) => {
      const { item: _item, ...body } = input;
      return api<Preference>(`/groups/${groupId}/preferences`, { method: "POST", body });
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Preference[]>(key);
      const now = new Date().toISOString();
      const optimistic: Preference = {
        id: `temp-${input.itemId}`,
        groupId,
        userId: user?.id ?? "",
        itemId: input.itemId,
        item: input.item,
        user: { id: user?.id ?? "", displayName: user?.displayName ?? "" },
        quantityText: input.quantityText ?? null,
        recurrence: input.recurrence ?? "staple",
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<Preference[]>(key, (old) => [...(old ?? []).filter((p) => p.itemId !== input.itemId), optimistic]);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => invalidateAfterWrite(qc, groupId),
  });
}

export function useUpdatePreference(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdatePreferenceBody & { id: string }) =>
      api<Preference>(`/groups/${groupId}/preferences/${id}`, { method: "PATCH", body }),
    onSettled: () => invalidateAfterWrite(qc, groupId),
  });
}

export function useDeletePreference(groupId: string) {
  const qc = useQueryClient();
  const key = keys.preferences(groupId, "me");
  return useMutation({
    mutationFn: (id: string) => api<void>(`/groups/${groupId}/preferences/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Preference[]>(key);
      qc.setQueryData<Preference[]>(key, (old) => old?.filter((p) => p.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => invalidateAfterWrite(qc, groupId),
  });
}
