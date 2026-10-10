import type { GroupDetail } from '@contracts/models';
import { useMemo } from 'react';

import { useCabinet } from '@/api/hooks/useCabinet';
import { useGroup } from '@/api/hooks/useGroup';
import { useInvites } from '@/api/hooks/useInvites';
import { useMe } from '@/api/hooks/useMe';
import { usePreferences } from '@/api/hooks/usePreferences';
import { allergenLabel } from '@/lib/format';

import { buildWants, type WantRow } from './wants';

export type MemberRow = {
  id: string;
  /** "Carson" or "Ian (you)" */
  name: string;
  /** raw display name, for the avatar initial */
  displayName: string;
  /** "Allergic to peanuts, milk" or "No allergies set" */
  allergyLine: string;
  roleLabel: 'Owner' | 'Member';
};

export type HouseholdData = {
  groupName?: string;
  memberCount?: number;
  /** null while loading / on error */
  members: MemberRow[] | null;
  pendingInvites: number;
  wants: WantRow[] | null;
  status: 'loading' | 'error' | 'ready';
  retry: () => void;
};

function toMemberRows(group: GroupDetail, meId: string | undefined): MemberRow[] {
  return group.members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    name: m.id === meId ? `${m.displayName} (you)` : m.displayName,
    allergyLine: m.allergens.length ? `Allergic to ${m.allergens.map(allergenLabel).join(', ')}` : 'No allergies set',
    roleLabel: m.role === 'owner' ? 'Owner' : 'Member',
  }));
}

/** Data hook for the Household tab (DESIGN.md §4.8): group + members, pending invites, everyone's wants. */
export function useHousehold(): HouseholdData {
  const group = useGroup();
  const invites = useInvites();
  const prefs = usePreferences('all');
  const cabinet = useCabinet();
  const me = useMe();
  const meId = me.data?.id;

  const members = useMemo(() => (group.data ? toMemberRows(group.data, meId) : null), [group.data, meId]);
  const wants = useMemo(
    () =>
      group.data && prefs.data && cabinet.data ? buildWants(prefs.data, cabinet.data, group.data.members, meId) : null,
    [group.data, prefs.data, cabinet.data, meId],
  );

  const required = [group, prefs, cabinet];
  const status = required.some((q) => q.isError) ? 'error' : members && wants ? 'ready' : 'loading';

  return {
    groupName: group.data?.name,
    memberCount: group.data?.memberCount,
    members,
    pendingInvites: invites.data?.filter((i) => i.status === 'pending').length ?? 0,
    wants,
    status,
    retry: () => {
      for (const q of required) if (q.isError) void q.refetch();
    },
  };
}
