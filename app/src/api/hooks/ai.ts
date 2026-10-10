import type { PricesResponse, Recipe, SuggestRecipesBody } from "@contracts/ai";
import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "../client";
import { keys } from "../keys";

/**
 * Recipe suggestions (Claude, 10–20 s). A mutation, never retried automatically (it's slow and rate-limited:
 * 10/hour/group → 429). Errors: 503 AI_UNAVAILABLE / NOT_CONFIGURED, 400 CABINET_EMPTY, 422 AI_REFUSED.
 */
export function useSuggestRecipes(groupId: string) {
  return useMutation({
    mutationFn: (body: Partial<SuggestRecipesBody>) =>
      api<Recipe[]>(`/groups/${groupId}/recipes/suggest`, { method: "POST", body }),
    retry: false,
  });
}

/**
 * Price estimate for the whole list (POST, cached 24 h on the server so refetching is cheap). Modeled as a query so
 * the List header chip and the Prices modal share one cached result. `enabled:false` = read the cache only.
 */
export function usePrices(groupId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: keys.prices(groupId),
    queryFn: () => api<PricesResponse>(`/groups/${groupId}/shopping-list/prices`, { method: "POST", body: {} }),
    enabled: !!groupId && opts.enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
