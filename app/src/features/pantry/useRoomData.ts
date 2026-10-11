/**
 * What the room props show (SPEC.md round 3), from the existing TanStack Query hooks (same caches as the sheets):
 * my first 3 preferences on the chalkboard, my name/initial on the polaroid, household members, pending invites and the
 * alert count on the cork board, and today's month on the meal-prep calendar. Display only; no business logic.
 */
import { useMemo, useState } from "react";

import { useGroupDetail, useGroupInvites } from "@/api/hooks/groups";
import { usePreferences } from "@/api/hooks/preferences";
import { useAlertCount } from "@/components/AlertsSection";
import { useAuth } from "@/state/AuthContext";

export type RoomData = {
  picks: string[];
  displayName: string;
  avatarInitial: string;
  members: { name: string; initial: string }[];
  inviteCount: number;
  alertCount: number;
  monthLabel: string;
  today: Date;
};

const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function useRoomData(groupId: string): RoomData {
  const { user } = useAuth();
  const prefs = usePreferences(groupId, "me");
  const detail = useGroupDetail(groupId);
  const invites = useGroupInvites(groupId);
  const alertCount = useAlertCount(groupId);
  // The calendar shows the day the screen opened (a remount picks up a new day).
  const [today] = useState(() => new Date());

  const picks = useMemo(() => (prefs.data ?? []).slice(0, 3).map((p) => p.item.name), [prefs.data]);
  const members = useMemo(
    () => (detail.data?.members ?? []).map((m) => ({ name: m.displayName, initial: initialOf(m.displayName) })),
    [detail.data],
  );
  const displayName = user?.displayName ?? "Me";
  const monthLabel = useMemo(() => today.toLocaleString("en-US", { month: "long" }), [today]);

  return {
    picks,
    displayName,
    avatarInitial: initialOf(displayName),
    members,
    inviteCount: (invites.data ?? []).filter((i) => i.status === "pending").length,
    alertCount,
    monthLabel,
    today,
  };
}
