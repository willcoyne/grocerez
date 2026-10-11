import type { PlanMeal } from "@contracts/agent";
import type { AddMissingResponse, MealPlanResponse, PlannedMeal } from "@contracts/mealPlan";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import { api } from "../client";
import { keys } from "../keys";

/**
 * Week calendar (spec §13). Group-scoped:
 *   useMealPlan(gid, from?, to?)      GET    /groups/:gid/meal-plan?from&to   (server defaults: today → today+6)
 *   useAddPlannedMeal(gid)            POST   /groups/:gid/meal-plan {date, meal}      (409 DATE_TAKEN, 422 PLAN_UNSAFE)
 *   useMovePlannedMeal(gid)           PATCH  /groups/:gid/meal-plan/:id {date}        (swaps when the date is taken)
 *   useRemovePlannedMeal(gid)         DELETE /groups/:gid/meal-plan/:id
 *   useAddMissingToList(gid)          POST   /groups/:gid/meal-plan/:id/add-missing → {added, skipped[]}
 * Every write refetches the plan; the server also emits "meal-plan:changed" for other phones.
 */
export function useMealPlan(groupId: string, from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: keys.mealPlan(groupId, from ?? null, to ?? null),
    queryFn: () =>
      api<MealPlanResponse>(`/groups/${groupId}/meal-plan`, { query: { from: from ?? undefined, to: to ?? undefined } }),
    enabled: !!groupId,
  });
}

function useInvalidatePlan(groupId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: keys.mealPlans(groupId) });
}

export function useAddPlannedMeal(groupId: string) {
  const invalidate = useInvalidatePlan(groupId);
  return useMutation({
    mutationFn: (body: { date: string; meal: PlanMeal }) =>
      api<PlannedMeal>(`/groups/${groupId}/meal-plan`, { method: "POST", body }),
    retry: false,
    onSettled: invalidate,
  });
}

export function useMovePlannedMeal(groupId: string) {
  const invalidate = useInvalidatePlan(groupId);
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      api<PlannedMeal>(`/groups/${groupId}/meal-plan/${id}`, { method: "PATCH", body: { date } }),
    retry: false,
    onSettled: invalidate,
  });
}

export function useRemovePlannedMeal(groupId: string) {
  const invalidate = useInvalidatePlan(groupId);
  return useMutation({
    mutationFn: (id: string) => api<void>(`/groups/${groupId}/meal-plan/${id}`, { method: "DELETE" }),
    retry: false,
    onSettled: invalidate,
  });
}

export function useAddMissingToList(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<z.infer<typeof AddMissingResponse>>(`/groups/${groupId}/meal-plan/${id}/add-missing`, { method: "POST", body: {} }),
    retry: false,
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.shoppingList(groupId) }),
  });
}
