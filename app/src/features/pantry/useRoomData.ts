/**
 * What the room props show (SPEC.md round 3), from the existing TanStack Query hooks (same caches as the sheets):
 * household members, pending invites and the alert count on the cork board. Display only; no business logic.
 */
import { useMemo } from "react";

import { useGroupDetail, useGroupInvites } from "@/api/hooks/groups";
import { useAlertCount } from "@/components/AlertsSection";

export type RoomData = {
  members: { name: string; initial: string }[];
  inviteCount: number;
  alertCount: number;
};

const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function useRoomData(groupId: string): RoomData {
  const detail = useGroupDetail(groupId);
  const invites = useGroupInvites(groupId);
  const alertCount = useAlertCount(groupId);
  const members = useMemo(
    () => (detail.data?.members ?? []).map((m) => ({ name: m.displayName, initial: initialOf(m.displayName) })),
    [detail.data],
  );
  return {
    members,
    inviteCount: (invites.data ?? []).filter((i) => i.status === "pending").length,
    alertCount,
  };
}
