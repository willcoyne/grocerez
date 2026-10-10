import type { Allergen, Diet, Dietary } from '@contracts/dietary';
import type { Item, Preference, Recurrence } from '@contracts/models';
import { useMemo } from 'react';

import { useCabinet } from '@/api/hooks/useCabinet';
import { useDietaryEditor } from '@/api/hooks/useDietary';
import { useGroup } from '@/api/hooks/useGroup';
import {
  useAddPreference,
  usePreferences,
  useRemovePreference,
  useUpdatePreference,
} from '@/api/hooks/usePreferences';
import { useToast } from '@/components/ui';

import { useRecurrenceChoice } from './recurrenceChoice';

export type PrefRow = Preference & { inCabinet: boolean };
export type LoadState = 'pending' | 'error' | 'success';

export type MeScreenModel = {
  groupName?: string;
  memberCount?: number;
  recurrence: Recurrence;
  setRecurrence: (r: Recurrence) => void;
  addItem: (item: Item) => Promise<void>;
  prefs: { state: LoadState; rows: PrefRow[]; retry: () => void };
  toggleRecurrence: (row: PrefRow) => void;
  remove: (row: PrefRow) => void;
  dietary: {
    state: LoadState;
    value: Dietary | undefined;
    toggleDiet: (d: Diet) => void;
    toggleAllergen: (a: Allergen) => void;
    retry: () => void;
  };
};

const FAIL = 'Something went wrong. Try again.';

/** Data hook for the Me tab (DESIGN.md §4.7). The View stays presentational. */
export function useMeScreen(): MeScreenModel {
  const toast = useToast();
  const group = useGroup();
  const prefsQ = usePreferences('me');
  const cabinetQ = useCabinet();
  const dietaryEditor = useDietaryEditor();
  const add = useAddPreference();
  const update = useUpdatePreference();
  const removePref = useRemovePreference();
  const [recurrence, setRecurrence] = useRecurrenceChoice();

  // Status chip: "In cabinet" when the item is in the cabinet as in_stock, otherwise "On the list".
  const rows = useMemo<PrefRow[]>(() => {
    const inStock = new Set((cabinetQ.data ?? []).filter((c) => c.status === 'in_stock').map((c) => c.itemId));
    return (prefsQ.data ?? []).map((p) => ({ ...p, inCabinet: inStock.has(p.itemId) }));
  }, [prefsQ.data, cabinetQ.data]);

  const addItem = async (item: Item) => {
    const { duplicate } = await add.mutateAsync({ itemId: item.id, recurrence });
    if (duplicate) toast.show(`${item.name} is already on your list`);
    else toast.show(recurrence === 'staple' ? `Added ${item.name} as a staple` : `Added ${item.name} for this week`);
  };

  return {
    groupName: group.data?.name,
    memberCount: group.data?.members.length,
    recurrence,
    setRecurrence,
    addItem,
    prefs: { state: prefsQ.status, rows, retry: () => void prefsQ.refetch() },
    toggleRecurrence: (row) =>
      update.mutate(
        { id: row.id, recurrence: row.recurrence === 'staple' ? 'one_time' : 'staple' },
        { onError: () => toast.show(FAIL) },
      ),
    remove: (row) => {
      // Optimistic: the row disappears at once, so confirm at once; a failure restores it.
      toast.show(`Removed ${row.item.name}`);
      removePref.mutate({ id: row.id }, { onError: () => toast.show(FAIL) });
    },
    dietary: {
      state: dietaryEditor.status,
      value: dietaryEditor.dietary,
      toggleDiet: dietaryEditor.toggleDiet,
      toggleAllergen: dietaryEditor.toggleAllergen,
      retry: dietaryEditor.refetch,
    },
  };
}
