import type { Category } from "@contracts/common";
import type { Item, ItemSearchResponse } from "@contracts/items";
import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "../client";
import { keys } from "../keys";

/** GET /items/search?q= (the caller debounces the text). Empty text → disabled. */
export function useItemSearch(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: keys.itemSearch(text.toLowerCase()),
    queryFn: ({ signal }) => api<ItemSearchResponse>("/items/search", { query: { q: text }, signal }),
    enabled: text.length > 0,
    staleTime: 5 * 60_000,
  });
}

export interface CreateItemInput {
  name: string;
  category?: Category;
  /** "Did you mean X?" → Yes: save the typed text as an alias of X. */
  aliasOf?: string;
}

export function useCreateItem() {
  return useMutation({
    mutationFn: (body: CreateItemInput) => api<Item>("/items", { method: "POST", body }),
  });
}
