import type { Category, Item, ItemSearch } from '@contracts/models';
import { useQuery } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useItemSearch(q: string): UseQueryResult<ItemSearch>   // GET /items/search?q= (disabled when q is blank)
 * searchItems(q: string): Promise<ItemSearch>             // imperative, used by useResolveItem
 * createItem(body: { name: string; category?: Category; aliasOf?: string }): Promise<Item>
 *   POST /items. With aliasOf, saves the typed text as an alias of that item and returns it.
 */
export function useItemSearch(q: string) {
  const trimmed = q.trim();
  return useQuery({ queryKey: qk.itemSearch(trimmed), queryFn: () => searchItems(trimmed), enabled: !!trimmed });
}

export function searchItems(q: string): Promise<ItemSearch> {
  return api<ItemSearch>(`/items/search?q=${encodeURIComponent(q)}`);
}

export function createItem(body: { name: string; category?: Category; aliasOf?: string }): Promise<Item> {
  return api<Item>('/items', { method: 'POST', body });
}
