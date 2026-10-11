import type { PricesResponse } from "@contracts/ai";
import { useQuery } from "@tanstack/react-query";

import { api } from "../client";
import { keys } from "../keys";

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
