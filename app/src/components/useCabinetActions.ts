import type { CabinetItem } from "@contracts/cabinet";

import { errorMessage } from "@/api/client";
import { useAddCabinetItem, useDeleteCabinetItem, useRanOut, useUpdateCabinetItem } from "@/api/hooks/cabinet";
import { useAddListItem } from "@/api/hooks/shoppingList";
import { useToast } from "@/components/ui";
import { setRanOutPrompt } from "@/features/cabinet/ranOutStore";
import { confirm } from "@/lib/confirm";

/**
 * Running low / back in stock / ran out (+ Undo, + the "add anyway?" prompt) / remove.
 * Shared by the Cabinet tab and ItemDetail. A requeued:false ran-out raises the RanOutPrompt on the Cabinet tab.
 */
export function useCabinetActions(groupId: string) {
  const update = useUpdateCabinetItem(groupId);
  const ranOut = useRanOut(groupId);
  const remove = useDeleteCabinetItem(groupId);
  const add = useAddCabinetItem(groupId);
  const addToList = useAddListItem(groupId);
  const { show: toast } = useToast();
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });
  const undo = (row: CabinetItem) => ({ action: { label: "Undo", onPress: () => restore(row) } });

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
    addingAnyway: addToList.isPending,
    markLow: (row: CabinetItem) =>
      update.mutate(
        { id: row.id, status: "running_low" },
        { onSuccess: () => toast(`Marked ${row.item.name} running low`), onError },
      ),
    backInStock: (row: CabinetItem) =>
      update.mutate({ id: row.id, status: "in_stock" }, { onSuccess: () => toast(`${row.item.name} is back in stock`), onError }),
    ranOut: (row: CabinetItem) =>
      ranOut.mutate(row.id, {
        onError,
        onSuccess: ({ requeued }) => {
          if (requeued) toast(`${row.item.name} is back on the shopping list`, undo(row));
          else setRanOutPrompt(row);
        },
      }),
    /** RanOutPrompt → "Add to list". */
    addAnyway: (row: CabinetItem) =>
      addToList.mutate(
        { itemId: row.itemId },
        {
          onSuccess: () => {
            setRanOutPrompt(null);
            toast(`${row.item.name} added to the shopping list`);
          },
          onError,
        },
      ),
    /** RanOutPrompt → "No thanks". The item is already out of the cabinet; offer Undo. */
    dismissRanOut: (row: CabinetItem) => {
      setRanOutPrompt(null);
      toast(`${row.item.name} removed from the cabinet`, undo(row));
    },
    remove: async (row: CabinetItem) => {
      if (!(await confirm(`Remove ${row.item.name}?`, "Use this for things thrown away or added by mistake.", "Remove", true))) return;
      remove.mutate(row.id, { onError, onSuccess: () => toast(`${row.item.name} removed`, undo(row)) });
    },
  };
}
