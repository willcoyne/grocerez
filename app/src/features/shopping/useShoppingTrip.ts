/**
 * Shopping-mode state: the list, check-off (saved immediately), Undo, and the batched "move to pantry" completion
 * (TripBatcher). Everything goes through the shared TanStack Query hooks; no business logic here.
 *
 * Mount this once per group (the screen keys it by groupId) so a group switch flushes the old group's batch with the
 * old group's mutation and never mixes data.
 */
import type { ShoppingListItem } from "@contracts/shoppingList";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { errorMessage } from "@/api/client";
import { useCheckItem, useCompleteTrip, useShoppingList } from "@/api/hooks/shoppingList";
import { useToast } from "@/components/ui";
import { plural } from "@/lib/format";
import { useSocketConnected } from "@/realtime/SocketProvider";
import { useAuth } from "@/state/AuthContext";

import { buildStoreSections, toStoreItem, type StoreItem } from "./mapping";
import { HOP_MS } from "./scene/layout";
import { GRACE_MS, TripBatcher, type TripBatcherSnapshot } from "./tripBatcher";

export type Flight = { id: string; dir: "in" | "out"; startedAt: number };

export type ShoppingTrip = ReturnType<typeof useShoppingTrip>;

export function useShoppingTrip(groupId: string, opts: { reducedMotion?: boolean } = {}) {
  const connected = useSocketConnected();
  // Live sync from the socket; poll every 5 s while it is down.
  const list = useShoppingList(groupId, { refetchInterval: connected ? false : 5000 });
  const check = useCheckItem(groupId);
  const complete = useCompleteTrip(groupId);
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const { show: toast } = useToast();

  // Latest mutation functions for the batcher (refs are only written in effects).
  const checkRef = useRef(check.mutateAsync);
  const completeRef = useRef(complete.mutateAsync);
  const toastRef = useRef(toast);
  useEffect(() => {
    checkRef.current = check.mutateAsync;
    completeRef.current = complete.mutateAsync;
    toastRef.current = toast;
  });

  const [batcher] = useState(
    () => new TripBatcher({ complete: () => completeRef.current().then((r) => r.movedToCabinet), graceMs: GRACE_MS }),
  );
  const [snap, setSnap] = useState<TripBatcherSnapshot>(() => batcher.snapshot());
  const [completedIds, setCompletedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    let alive = true;
    batcher.setListener({
      onChange: () => alive && setSnap(batcher.snapshot()),
      onCompleted: (n, ids) => {
        if (alive) {
          setCompletedIds((cur) => new Set([...cur, ...ids]));
          setMoved((m) => m + n);
        }
        // The toast lives at the app root, so it still shows after the screen has closed.
        if (n > 0) toastRef.current(`Added ${plural(n, "item")} to your pantry`);
      },
      onError: (err, willRetry) =>
        toastRef.current(
          willRetry
            ? `Couldn't move items to your pantry yet. Retrying… (${errorMessage(err)})`
            : "Couldn't move items to your pantry. They stay checked and will be added next time.",
          { tone: "error" },
        ),
      onCheckFailed: (_id, checked, err) =>
        toastRef.current(`Couldn't ${checked ? "check off" : "put back"} that item: ${errorMessage(err)}`, { tone: "error" }),
    });
    return () => {
      // Leaving the screen (Back, Done, unmount): finish the trip now. The completion keeps running after unmount.
      alive = false;
      batcher.setListener({
        onCompleted: (n) => n > 0 && toastRef.current(`Added ${plural(n, "item")} to your pantry`),
        onError: (_e, willRetry) =>
          !willRetry && toastRef.current("Couldn't move items to your pantry. They'll be added next time.", { tone: "error" }),
      });
      batcher.flush();
    };
  }, [batcher]);

  // App going to the background (or being closed): complete right away.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") batcher.flush();
    });
    return () => sub.remove();
  }, [batcher]);

  // Rows already checked when the screen opened (left over from a closed app) go in the cart and complete after the grace.
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !list.data) return;
    adopted.current = true;
    const leftovers = list.data.filter((r) => r.checked).map((r) => r.id);
    if (leftovers.length) batcher.adopt(leftovers);
  }, [list.data, batcher]);

  // ---- hop animations ----
  const [flights, setFlights] = useState<Record<string, Flight>>({});
  const flightTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = flightTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const launch = useCallback(
    (id: string, dir: Flight["dir"]) => {
      if (opts.reducedMotion) return;
      const timers = flightTimers.current;
      const prev = timers.get(id);
      if (prev) clearTimeout(prev);
      setFlights((f) => ({ ...f, [id]: { id, dir, startedAt: Date.now() } }));
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          setFlights((f) => {
            const { [id]: _done, ...rest } = f;
            return rest;
          });
        }, HOP_MS + 60),
      );
    },
    [opts.reducedMotion],
  );

  // ---- actions ----
  const rows = useMemo(() => (list.data ?? []).filter((r) => !completedIds.has(r.id)), [list.data, completedIds]);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const undo = useCallback(
    (id: string) => {
      if (!batcher.unchecked(id)) {
        toastRef.current("Already on its way to your pantry");
        return false;
      }
      launch(id, "out");
      batcher.track(id, false, checkRef.current({ id, checked: false })).catch(() => {});
      return true;
    },
    [batcher, launch],
  );

  const checkOff = useCallback(
    (row: ShoppingListItem) => {
      if (row.checked || batcher.isPending(row.id)) return;
      launch(row.id, "in");
      batcher.checked(row.id);
      batcher.track(row.id, true, checkRef.current({ id: row.id, checked: true })).catch(() => {});
      toastRef.current(`${row.item.name} is in the cart`, {
        action: { label: "Undo", onPress: () => undo(row.id) },
        durationMs: GRACE_MS,
      });
    },
    [batcher, launch, undo],
  );

  /** 2D list: one control that checks or puts back. */
  const toggle = useCallback(
    (row: ShoppingListItem) => {
      if (row.checked) {
        if (batcher.canUndo(row.id)) undo(row.id);
        else if (!batcher.isPending(row.id)) {
          // Checked by someone else (not part of our batch): plain uncheck.
          checkRef.current({ id: row.id, checked: false }).catch(() => {});
        }
      } else checkOff(row);
    },
    [batcher, checkOff, undo],
  );

  const finish = useCallback(() => batcher.flush(), [batcher]);

  // ---- derived view data ----
  const items: StoreItem[] = useMemo(() => rows.map((r) => toStoreItem(r, meId)), [rows, meId]);
  const sections = useMemo(() => buildStoreSections(items), [items]);
  const cart = useMemo(() => items.filter((it) => it.row.checked), [items]);
  const remaining = items.length - cart.length;
  const total = items.length + completedIds.size;
  const done = cart.length + completedIds.size;

  return {
    list,
    meId,
    items,
    sections,
    cart,
    remaining,
    total,
    done,
    moved,
    flights,
    pending: snap.pending,
    completing: snap.completing || complete.isPending,
    saving: snap.inflight > 0,
    checkOff,
    undo,
    toggle,
    finish,
    canUndo: (id: string) => batcher.canUndo(id),
  };
}
