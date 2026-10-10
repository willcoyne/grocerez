import type { UpdateMeBody, User } from "@contracts/auth";
import type { Dietary } from "@contracts/dietary";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/state/AuthContext";
import { api } from "../client";
import { keys } from "../keys";

/** PATCH /me {displayName?, zipCode?, avatarKey?}. Updates the signed-in user everywhere. */
export function useUpdateMe() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (body: UpdateMeBody) => api<User>("/me", { method: "PATCH", body }),
    onSuccess: (user) => setUser(user),
  });
}

export function useDietary(enabled = true) {
  return useQuery({ queryKey: keys.dietary, queryFn: () => api<Dietary>("/me/dietary"), enabled });
}

/** PUT /me/dietary. The server regenerates every group's list (allergen flags), so lists are invalidated. */
export function useUpdateDietary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Dietary) => api<Dietary>("/me/dietary", { method: "PUT", body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: keys.dietary });
      const prev = qc.getQueryData<Dietary>(keys.dietary);
      qc.setQueryData(keys.dietary, body);
      return { prev };
    },
    onError: (_e, _b, ctx) => qc.setQueryData(keys.dietary, ctx?.prev),
    onSuccess: (data) => {
      qc.setQueryData(keys.dietary, data);
      void qc.invalidateQueries({ queryKey: ["group"] });
    },
  });
}
