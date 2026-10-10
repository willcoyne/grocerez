import type { Item } from '@contracts/models';
import { useCallback, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { createItem, searchItems } from '@/api/hooks/useItemSearch';

/**
 * Item resolution flow (DESIGN.md §5), shared by the Me, List and Cabinet add fields.
 *
 * useResolveItem(onResolved: (item: Item) => Promise<void> | void): {
 *   resolve(text: string): Promise<void>   // trims; ignores blank. exact → onResolved; none → create → onResolved;
 *                                          // suggested → shows the banner (suggestion becomes non-null)
 *   suggestion: { typed: string; item: Item } | null   // non-null only for the field that triggered it
 *   accept(): Promise<void>   // "Yes" → POST /items {name: typed, aliasOf} → onResolved(item)
 *   reject(): Promise<void>   // "No, add …" → POST /items {name: typed} → onResolved(newItem)
 *   dismiss(): void           // call when the field's text changes
 *   busy: boolean
 * }
 * Errors from the API reject resolve/accept/reject; the caller shows them.
 */

// Only one banner app-wide: the owner is the hook instance that last showed a suggestion.
let owner: string | null = null;
const ownerListeners = new Set<() => void>();
function setOwner(next: string | null) {
  owner = next;
  for (const l of ownerListeners) l();
}
const subscribeOwner = (cb: () => void) => {
  ownerListeners.add(cb);
  return () => ownerListeners.delete(cb);
};

type Suggestion = { typed: string; item: Item };

export function useResolveItem(onResolved: (item: Item) => Promise<void> | void) {
  const id = useId();
  const currentOwner = useSyncExternalStore(subscribeOwner, () => owner);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const onResolvedRef = useRef(onResolved);
  useLayoutEffect(() => {
    onResolvedRef.current = onResolved;
  });

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setSuggestion(null);
    if (owner === id) setOwner(null);
  }, [id]);

  const resolve = useCallback(
    (text: string) =>
      run(async () => {
        const typed = text.trim();
        if (!typed) return;
        dismiss();
        const res = await searchItems(typed);
        if (res.match === 'exact' && res.results[0]) {
          await onResolvedRef.current(res.results[0]);
        } else if (res.match === 'suggested' && res.results[0]) {
          setSuggestion({ typed, item: res.results[0] });
          setOwner(id);
        } else {
          await onResolvedRef.current(await createItem({ name: typed }));
        }
      }),
    [run, dismiss, id],
  );

  const accept = useCallback(
    () =>
      run(async () => {
        if (!suggestion) return;
        const item = await createItem({ name: suggestion.typed, aliasOf: suggestion.item.id });
        dismiss();
        await onResolvedRef.current(item);
      }),
    [run, suggestion, dismiss],
  );

  const reject = useCallback(
    () =>
      run(async () => {
        if (!suggestion) return;
        const item = await createItem({ name: suggestion.typed });
        dismiss();
        await onResolvedRef.current(item);
      }),
    [run, suggestion, dismiss],
  );

  return {
    resolve,
    suggestion: currentOwner === id ? suggestion : null,
    accept,
    reject,
    dismiss,
    busy,
  };
}
