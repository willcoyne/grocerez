import type { CabinetItem } from "@contracts/cabinet";

import { errorMessage } from "@/api/client";
import { useAddCabinetItem, useDeleteCabinetItem, useRanOut, useUpdateCabinetItem } from "@/api/hooks/cabinet";
import { useAddListItem } from "@/api/hooks/shoppingList";
import { confirm } from "@/lib/confirm";
import { useToast } from "@/components/ui";

/** Running low / back in stock / ran out (+ Undo, + "add anyway?") / remove. Shared by the Cabinet tab and ItemDetail. */
export function useCabinetActions(groupId: string) {
  const update = useUpdateCabinetItem(groupId);
  const ranOut = useRanOut(groupId);
  const remove = useDeleteCabinetItem(groupId);
  const add = useAddCabinetItem(groupId);
  const addToList = useAddListItem(groupId);
  const { show: toast } = useToast();
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  /** Undo = POST cabinet with the same item (keeps a manual date; estimated dates are re-estimated by the server). */
  const restore = (row: CabinetItem) =>
    add.mutate(
      {
        itemId: row.itemId,
        location: row.location ?? undefined,
        quantityText: row.quantityText,
        expiresAt: row.expirationSource === "manual" && row.expiresAt ? row.expiresAt : undefined,
      },
      { onError },
    );

  return {
    busy: update.isPending || ranOut.isPending || remove.isPending,
    markLow: (row: CabinetItem) =>
      update.mutate({ id: row.id, status: "running_low" }, { onSuccess: () => toast(`${row.item.name} is on the list`), onError }),
    backInStock: (row: CabinetItem) => update.mutate({ id: row.id, status: "in_stock" }, { onError }),
    ranOut: (row: CabinetItem) =>
      ranOut.mutate(row.id, {
        onError,
        onSuccess: async ({ requeued }) => {
          if (requeued) {
            toast(`${row.item.name} ran out and is back on the list`, { action: { label: "Undo", onPress: () => restore(row) } });
            return;
          }
          const yes = await confirm(
            `${row.item.name} ran out`,
            "Nobody has this in their preferences. Add to shopping list anyway?",
            "Add to list",
          );
          if (yes) addToList.mutate({ itemId: row.itemId }, { onSuccess: () => toast(`${row.item.name} added to the list`), onError });
          else toast(`${row.item.name} removed`, { action: { label: "Undo", onPress: () => restore(row) } });
        },
      }),
    remove: async (row: CabinetItem) => {
      if (!(await confirm(`Remove ${row.item.name}?`, "Use this for things thrown away or added by mistake.", "Remove", true))) return;
      remove.mutate(row.id, { onError, onSuccess: () => toast(`${row.item.name} removed`, { action: { label: "Undo", onPress: () => restore(row) } }) });
    },
  };
}
