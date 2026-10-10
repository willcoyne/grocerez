import type { Invite } from '@contracts/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveGroupId } from '@/state/ActiveGroupContext';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useInvites(): UseQueryResult<Invite[]>            // GET /groups/:gid/invites (pending only)
 * useSendInvite(): UseMutationResult<Invite, ApiError, { email: string }>
 *   POST /groups/:gid/invites. 409 ALREADY_MEMBER is thrown as ApiError (check error.code).
 * useRevokeInvite(): UseMutationResult<void, ApiError, { inviteId: string }>
 *   DELETE /groups/:gid/invites/:id. Only the owner or the inviter may revoke (use group.role and invite.invitedBy.id).
 */
export function useInvites() {
  const gid = useActiveGroupId();
  return useQuery({
    queryKey: qk.invites(gid ?? ''),
    queryFn: () => api<Invite[]>(`/groups/${gid}/invites`),
    enabled: !!gid,
  });
}

export function useSendInvite() {
  const qc = useQueryClient();
  const gid = useActiveGroupId();
  return useMutation({
    mutationFn: ({ email }: { email: string }) =>
      api<Invite>(`/groups/${gid}/invites`, { method: 'POST', body: { email: email.trim().toLowerCase() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(gid ?? '') }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  const gid = useActiveGroupId();
  return useMutation({
    mutationFn: ({ inviteId }: { inviteId: string }) =>
      api<void>(`/groups/${gid}/invites/${inviteId}`, { method: 'DELETE' }),
    onMutate: ({ inviteId }) => {
      qc.setQueryData<Invite[]>(qk.invites(gid ?? ''), (old) => old?.filter((i) => i.id !== inviteId));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.invites(gid ?? '') }),
  });
}
