import type { Group, MyInvite } from '@contracts/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useActiveGroup } from '@/state/ActiveGroupContext';
import { useAuth } from '@/state/AuthContext';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useMyInvites(): UseQueryResult<MyInvite[]>
 *   GET /me/invites. Refetches when the app returns to the foreground; `invites:changed` also refetches (realtime).
 * useAcceptInvite(): UseMutationResult<Group, ApiError, { inviteId: string }>
 *   POST /invites/:id/accept → makes the group active → refreshes groups (the route guard then shows the tabs).
 * useDeclineInvite(): UseMutationResult<void, ApiError, { inviteId: string }>
 *   POST /invites/:id/decline → removes the card immediately.
 */
export function useMyInvites() {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: qk.myInvites(),
    queryFn: () => api<MyInvite[]>('/me/invites'),
    enabled: !!token,
  });

  const { refetch } = query;
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });
    return () => sub.remove();
  }, [token, refetch]);

  return query;
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  const { setActiveGroupId } = useActiveGroup();
  return useMutation({
    mutationFn: ({ inviteId }: { inviteId: string }) => api<Group>(`/invites/${inviteId}/accept`, { method: 'POST' }),
    onSuccess: async (group, { inviteId }) => {
      setActiveGroupId(group.id);
      qc.setQueryData<MyInvite[]>(qk.myInvites(), (old) => old?.filter((i) => i.id !== inviteId));
      await qc.invalidateQueries({ queryKey: qk.groups() });
    },
  });
}

export function useDeclineInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ inviteId }: { inviteId: string }) => api<void>(`/invites/${inviteId}/decline`, { method: 'POST' }),
    onMutate: ({ inviteId }) => {
      const prev = qc.getQueryData<MyInvite[]>(qk.myInvites());
      qc.setQueryData<MyInvite[]>(qk.myInvites(), (old) => old?.filter((i) => i.id !== inviteId));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.myInvites(), ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.myInvites() }),
  });
}
