import type { AlertsResponse } from "@contracts/alerts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../client";
import { keys } from "../keys";

/** GET /alerts → {expiring (≤ 3 days, incl. expired), recalls}. The server decides what counts as expiring. */
export function useAlerts(groupId: string) {
  return useQuery({
    queryKey: keys.alerts(groupId),
    queryFn: () => api<AlertsResponse>(`/groups/${groupId}/alerts`),
    enabled: !!groupId,
  });
}

export function useDismissRecall(groupId: string) {
  const qc = useQueryClient();
  const key = keys.alerts(groupId);
  return useMutation({
    mutationFn: (matchId: string) => api<void>(`/groups/${groupId}/alerts/recalls/${matchId}/dismiss`, { method: "POST" }),
    onMutate: async (matchId) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AlertsResponse>(key);
      qc.setQueryData<AlertsResponse>(key, (old) => old && { ...old, recalls: old.recalls.filter((r) => r.id !== matchId) });
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
