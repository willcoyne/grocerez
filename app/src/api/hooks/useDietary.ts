import type { Allergen, Diet, Dietary } from '@contracts/dietary';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useActiveGroupId } from '@/state/ActiveGroupContext';
import { useAuth } from '@/state/AuthContext';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useDietary(): UseQueryResult<Dietary>   // GET /me/dietary → { diets, allergens }
 * useDietaryEditor(): {
 *   dietary: Dietary | undefined
 *   toggleDiet(d: Diet): void            // optimistic; PUT /me/dietary debounced 400 ms
 *   toggleAllergen(a: Allergen): void
 *   status: 'pending' | 'error' | 'success'   // of the GET
 *   refetch(): void
 * }
 * After a save, the group, list (allergen flags), and dietary queries are refreshed.
 */
export function useDietary() {
  const { token } = useAuth();
  return useQuery({ queryKey: qk.dietary(), queryFn: () => api<Dietary>('/me/dietary'), enabled: !!token });
}

const DEBOUNCE_MS = 400;

export function useDietaryEditor() {
  const qc = useQueryClient();
  const gid = useActiveGroupId() ?? '';
  const query = useDietary();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (body: Dietary) => api<Dietary>('/me/dietary', { method: 'PUT', body }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.dietary() }),
        qc.invalidateQueries({ queryKey: qk.list(gid) }),
        qc.invalidateQueries({ queryKey: qk.group(gid) }),
      ]),
  });
  const { mutate } = save;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const update = useCallback(
    (change: (d: Dietary) => Dietary) => {
      const current = qc.getQueryData<Dietary>(qk.dietary()) ?? { diets: [], allergens: [] };
      const next = change(current);
      qc.setQueryData(qk.dietary(), next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        mutate(qc.getQueryData<Dietary>(qk.dietary()) ?? next);
      }, DEBOUNCE_MS);
    },
    [qc, mutate],
  );

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return {
    dietary: query.data,
    status: query.status,
    refetch: () => void query.refetch(),
    toggleDiet: (d: Diet) => update((cur) => ({ ...cur, diets: toggle(cur.diets, d) })),
    toggleAllergen: (a: Allergen) => update((cur) => ({ ...cur, allergens: toggle(cur.allergens, a) })),
  };
}
