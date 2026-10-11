import { useQuery } from "@tanstack/react-query";

import { api } from "../client";

/** GET /health → {ok:true}. Shown on the sign-in screen so you can tell the phone reaches the laptop's server. */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ ok: boolean }>("/health"),
    retry: false,
    staleTime: 10_000,
  });
}
