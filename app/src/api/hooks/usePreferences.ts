import type { Preference, Recurrence } from '@contracts/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveGroupId } from '@/state/ActiveGroupContext';

import { api } from '../client';
import { qk, type PrefScope } from '../keys';

/**
 * usePreferences(scope: 'me' | 'all' = 'me'): UseQueryResult<Preference[]>
 *   GET /groups/:gid/preferences?userId=me|all (creation order). 'all' is grouped by item on the client.
 * useAddPreference(): UseMutationResult<{ pref: Preference; duplicate: boolean }, ApiError, { itemId: string; recurrence: Recurrence }>
 *   If I already want the item (cached 'me' list), resolves { duplicate: true } without a request.
 * useUpdatePreference(): UseMutationResult<Preference, ApiError, { id: string; recurrence: Recurrence }>
 * useRemovePreference(): UseMutationResult<void, ApiError, { id: string }>   // optimistic
 * Every write invalidates preferences + list (the server regenerates the list).
 */
export function usePreferences(scope: PrefScope = 'me') {
  const gid = useActiveGroupId();
  return useQuery({
    queryKey: qk.prefs(gid ?? '', scope),
    queryFn: () => api<Preference[]>(`/groups/${gid}/preferences?userId=${scope}`),
    enabled: !!gid,
  });
}

function useInvalidatePrefsAndList() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.prefsAll(gid) }),
      qc.invalidateQueries({ queryKey: qk.list(gid) }),
    ]);
}

export function useAddPreference() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidatePrefsAndList();
  return useMutation({
    mutationFn: async ({ itemId, recurrence }: { itemId: string; recurrence: Recurrence }) => {
      const existing = qc.getQueryData<Preference[]>(qk.prefs(gid, 'me'))?.find((p) => p.itemId === itemId);
      if (existing) return { pref: existing, duplicate: true };
      const pref = await api<Preference>(`/groups/${gid}/preferences`, {
        method: 'POST',
        body: { itemId, recurrence },
      });
      return { pref, duplicate: false };
    },
    onSuccess: invalidate,
  });
}

export function useUpdatePreference() {
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidatePrefsAndList();
  return useMutation({
    mutationFn: ({ id, recurrence }: { id: string; recurrence: Recurrence }) =>
      api<Preference>(`/groups/${gid}/preferences/${id}`, { method: 'PATCH', body: { recurrence } }),
    onSuccess: invalidate,
  });
}

export function useRemovePreference() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  const invalidate = useInvalidatePrefsAndList();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api<void>(`/groups/${gid}/preferences/${id}`, { method: 'DELETE' }),
    onMutate: ({ id }) => {
      const prev = qc.getQueryData<Preference[]>(qk.prefs(gid, 'me'));
      qc.setQueryData<Preference[]>(qk.prefs(gid, 'me'), (old) => old?.filter((p) => p.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.prefs(gid, 'me'), ctx?.prev),
    onSettled: invalidate,
  });
}
