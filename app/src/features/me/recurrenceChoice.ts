import type { Recurrence } from '@contracts/models';
import { useSyncExternalStore } from 'react';

/**
 * Session-scoped Staple / This week only choice (DESIGN.md §4.7). Module-level so it survives
 * tab switches and unmounts; resets when the app process restarts.
 */
let current: Recurrence = 'staple';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setRecurrenceChoice(next: Recurrence) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export function useRecurrenceChoice(): [Recurrence, (r: Recurrence) => void] {
  const value = useSyncExternalStore(subscribe, () => current, () => current);
  return [value, setRecurrenceChoice];
}

/** Test helper: back to the default (Staple). */
export function resetRecurrenceChoice() {
  setRecurrenceChoice('staple');
}
