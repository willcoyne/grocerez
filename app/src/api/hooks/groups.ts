import type { Group, GroupDetail, Invite, MyInvite } from "@contracts/groups";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../client";
import { keys } from "../keys";

export function useGroups(enabled = true) {
  return useQuery({ queryKey: keys.groups, queryFn: () => api<Group[]>("/groups"), enabled });
}

export function useGroupDetail(groupId: string | null | undefined) {
  return useQuery({
    queryKey: keys.groupDetail(groupId ?? "none"),
    queryFn: () => api<GroupDetail>(`/groups/${groupId}`),
    enabled: !!groupId,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Group>("/groups", { method: "POST", body: { name } }),
    onSuccess: (group) => {
      qc.setQueryData<Group[]>(keys.groups, (old) => [...(old ?? []).filter((g) => g.id !== group.id), group]);
      void qc.invalidateQueries({ queryKey: keys.groups });
    },
  });
}

export function useRenameGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Group>(`/groups/${groupId}`, { method: "PATCH", body: { name } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: keys.groupDetail(groupId) });
    },
  });
}

/** Leave or delete: both drop the group from the switcher. */
function useDropGroup(groupId: string, request: () => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      qc.setQueryData<Group[]>(keys.groups, (old) => (old ?? []).filter((g) => g.id !== groupId));
      qc.removeQueries({ queryKey: keys.group(groupId) });
      void qc.invalidateQueries({ queryKey: keys.groups });
    },
  });
}

export function useDeleteGroup(groupId: string) {
  return useDropGroup(groupId, () => api<void>(`/groups/${groupId}`, { method: "DELETE" }));
}

export function useLeaveGroup(groupId: string) {
  return useDropGroup(groupId, () => api<void>(`/groups/${groupId}/leave`, { method: "POST" }));
}

export function useRemoveMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/groups/${groupId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.group(groupId) });
      void qc.invalidateQueries({ queryKey: keys.groups });
    },
  });
}

// ─── Invites ────────────────────────────────────────────────────────────────

export function useGroupInvites(groupId: string | null | undefined) {
  return useQuery({
    queryKey: keys.groupInvites(groupId ?? "none"),
    queryFn: () => api<Invite[]>(`/groups/${groupId}/invites`),
    enabled: !!groupId,
  });
}

export function useCreateInvite(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api<Invite>(`/groups/${groupId}/invites`, { method: "POST", body: { email } }),
    // Inviting the same address twice is not a retryable situation; 4xx are never retried (see isRetryable).
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.groupInvites(groupId) }),
  });
}

export function useRevokeInvite(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api<void>(`/groups/${groupId}/invites/${inviteId}`, { method: "DELETE" }),
    onMutate: async (inviteId) => {
      await qc.cancelQueries({ queryKey: keys.groupInvites(groupId) });
      const prev = qc.getQueryData<Invite[]>(keys.groupInvites(groupId));
      qc.setQueryData<Invite[]>(keys.groupInvites(groupId), (old) => old?.filter((i) => i.id !== inviteId));
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(keys.groupInvites(groupId), ctx?.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.groupInvites(groupId) }),
  });
}

export function useMyInvites(enabled = true) {
  return useQuery({ queryKey: keys.myInvites, queryFn: () => api<MyInvite[]>("/me/invites"), enabled });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api<Group>(`/invites/${inviteId}/accept`, { method: "POST" }),
    onSuccess: async (group) => {
      qc.setQueryData<MyInvite[]>(keys.myInvites, (old) => old?.filter((i) => i.groupId !== group.id));
      qc.setQueryData<Group[]>(keys.groups, (old) => [...(old ?? []).filter((g) => g.id !== group.id), group]);
      await qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: keys.myInvites });
    },
  });
}

export function useDeclineInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api<void>(`/invites/${inviteId}/decline`, { method: "POST" }),
    onSuccess: (_v, inviteId) => {
      qc.setQueryData<MyInvite[]>(keys.myInvites, (old) => old?.filter((i) => i.id !== inviteId));
      void qc.invalidateQueries({ queryKey: keys.myInvites });
    },
  });
}
