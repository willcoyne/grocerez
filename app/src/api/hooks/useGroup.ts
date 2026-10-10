import type { Group, GroupDetail } from '@contracts/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveGroup, useActiveGroupId } from '@/state/ActiveGroupContext';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useGroup(): UseQueryResult<GroupDetail>   // GET /groups/:activeGroupId → group + members (with allergens)
 * useCreateGroup(): UseMutationResult<Group, Error, { name: string }>
 *   POST /groups → sets the new group active → invalidates groups.
 *   Navigate (e.g. to /invite?from=onboarding) right after mutateAsync resolves.
 * The list of my groups lives in useActiveGroup() (src/state/ActiveGroupContext.tsx).
 */
export function useGroup() {
  const gid = useActiveGroupId();
  return useQuery({
    queryKey: qk.group(gid ?? ''),
    queryFn: () => api<GroupDetail>(`/groups/${gid}`),
    enabled: !!gid,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  const { setActiveGroupId } = useActiveGroup();
  return useMutation({
    mutationFn: ({ name }: { name: string }) => api<Group>('/groups', { method: 'POST', body: { name } }),
    onSuccess: (group) => {
      setActiveGroupId(group.id);
      qc.setQueryData<Group[]>(qk.groups(), (old) => [...(old ?? []).filter((g) => g.id !== group.id), group]);
      void qc.invalidateQueries({ queryKey: qk.groups() });
    },
  });
}
