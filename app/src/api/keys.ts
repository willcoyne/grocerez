/**
 * Query keys. Everything that belongs to a household is under ["group", groupId, ...] so
 * (1) switching groups can never show another group's cached data and (2) a socket event for a group
 * can invalidate exactly that group's queries.
 */
export const keys = {
  me: ["me"] as const,
  dietary: ["me", "dietary"] as const,
  myInvites: ["me", "invites"] as const,
  groups: ["groups"] as const,
  group: (groupId: string) => ["group", groupId] as const,
  groupDetail: (groupId: string) => ["group", groupId, "detail"] as const,
  groupInvites: (groupId: string) => ["group", groupId, "invites"] as const,
  preferences: (groupId: string, userId: "me" | "all") => ["group", groupId, "preferences", userId] as const,
  preferencesAll: (groupId: string) => ["group", groupId, "preferences"] as const,
  cabinet: (groupId: string) => ["group", groupId, "cabinet"] as const,
  shoppingList: (groupId: string) => ["group", groupId, "shopping-list"] as const,
  alerts: (groupId: string) => ["group", groupId, "alerts"] as const,
  prices: (groupId: string) => ["group", groupId, "prices"] as const,
  /** Pantry Agent: the recent-runs list (also the prefix of every single run's key). */
  agentRuns: (groupId: string) => ["group", groupId, "agent-runs"] as const,
  agentRun: (groupId: string, runId: string) => ["group", groupId, "agent-runs", runId] as const,
  /** Week calendar (spec §13): every date range of a group's plan lives under this prefix. */
  mealPlans: (groupId: string) => ["group", groupId, "meal-plan"] as const,
  mealPlan: (groupId: string, from: string | null, to: string | null) => ["group", groupId, "meal-plan", from ?? "", to ?? ""] as const,
  itemSearch: (q: string) => ["items", "search", q] as const,
};
