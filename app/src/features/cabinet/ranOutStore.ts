import type { CabinetItem } from "@contracts/cabinet";
import { useSyncExternalStore } from "react";

/**
 * The pending "ran out, nobody wants it" prompt (DESIGN.md §4.6). Shared so ItemDetail can raise it and
 * the Cabinet tab (where the user lands after going back) shows it.
 */
let current: CabinetItem | null = null;
const listeners = new Set<() => void>();

export function setRanOutPrompt(row: CabinetItem | null) {
  current = row;
  listeners.forEach((l) => l());
}

export function useRanOutPrompt(): CabinetItem | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
