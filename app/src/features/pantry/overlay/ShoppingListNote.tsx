/**
 * The shopping list as a paper notepad (SPEC.md round 2): opens after the camera flies to the note pinned on the pantry
 * and the paper lifts off its pin. Plain React Native (works on web + native), layered over the canvas.
 * It replaced the List tab, so it carries everything that tab did: check-off, price estimate (+ per-row prices),
 * scan-to-match, running-low and Pantry Agent notes, and "Finish trip" (checked rows → cabinet → expiration check).
 *
 * Thin client: rows, aisle order, allergen flags and the "preference rows can't be deleted" rule all come from the
 * server; this view only groups what it gets (unchecked by category in server order, checked at the bottom).
 */
import type { Item } from "@contracts/items";
import type { ShoppingListItem } from "@contracts/shoppingList";
import { useMutationState } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AlertTriangle, Check, Plus, ScanBarcode, Sparkles, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiError, errorMessage } from "@/api/client";
import { usePrices } from "@/api/hooks/ai";
import { useCabinet } from "@/api/hooks/cabinet";
import { useGroupDetail } from "@/api/hooks/groups";
import { useAddListItem, useCheckItem, useCompleteTrip, useDeleteListItem, useShoppingList } from "@/api/hooks/shoppingList";
import { RecallBanner } from "@/components/AlertsSection";
import { ItemPicker } from "@/components/ItemPicker";
import { AiLabel, AppText, ErrorState, useToast } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { formatCents, formatCentsRange, labelize, plural } from "@/lib/format";
import { maybeAskNotificationPermission } from "@/notifications/expirations";
import { useSocketConnected } from "@/realtime/SocketProvider";
import { useAuth } from "@/state/AuthContext";

import { allergenLabel, type OverlayPalette, useOverlayPalette, useOverlayStyles } from "./palette";
import { makePaperStyles, PAPER_MARGIN_X, PAPER_RULE, PaperCaption, PaperPrimaryButton, PaperSheet } from "./PaperSheet";

export type ShoppingListNoteProps = {
  visible: boolean;
  groupId: string;
  onClose: () => void;
};

/** Notepad colours (now shared with the Week sheet, see PaperSheet.tsx). */
export { NOTE_PAPER } from "./PaperSheet";

const RULE = PAPER_RULE; // row rhythm (also the minimum tap height)
const MARGIN_X = PAPER_MARGIN_X;

/** Server 409 for deleting a row that exists because of someone's preference. */
function isPreferenceRowError(e: unknown) {
  return e instanceof ApiError && (e.status === 409 || e.code === "PREFERENCE_ROW" || e.code === "LIST_ITEM_IS_PREFERENCE");
}

type Section = { key: string; title: string; rows: ShoppingListItem[] };

/** Unchecked rows grouped by category in the server's aisle order; checked rows separately (bottom of the page). */
export function noteSections(rows: readonly ShoppingListItem[]): { toBuy: Section[]; checked: ShoppingListItem[] } {
  const order: string[] = [];
  const by = new Map<string, ShoppingListItem[]>();
  const checked: ShoppingListItem[] = [];
  for (const r of rows) {
    if (r.checked) {
      checked.push(r);
      continue;
    }
    const cat = r.item.category ?? "other";
    if (!by.has(cat)) {
      by.set(cat, []);
      order.push(cat);
    }
    by.get(cat)!.push(r);
  }
  return { toBuy: order.map((cat) => ({ key: cat, title: labelize(cat), rows: by.get(cat)! })), checked };
}

export function ShoppingListNote({ visible, groupId, onClose }: ShoppingListNoteProps) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  if (!visible) return null;
  return <NoteSheet groupId={groupId} onClose={onClose} />;
}

function NoteSheet({ groupId, onClose }: Omit<ShoppingListNoteProps, "visible">) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const connected = useSocketConnected();
  // Live sync comes from the socket; while it's down, poll every 5 s while the note is open.
  const list = useShoppingList(groupId, { refetchInterval: connected ? false : 5000 });
  const check = useCheckItem(groupId);
  const add = useAddListItem(groupId);
  const del = useDeleteListItem(groupId);
  const complete = useCompleteTrip(groupId);
  const detail = useGroupDetail(groupId);
  const cabinet = useCabinet(groupId);
  const router = useRouter();
  const { user } = useAuth();
  const meId = user?.id;
  const { show: toast } = useToast();
  const [picking, setPicking] = useState(false);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of detail.data?.members ?? []) m.set(mem.id, mem.displayName);
    return m;
  }, [detail.data]);
  const lowItemIds = useMemo(
    () => new Set((cabinet.data ?? []).filter((c) => c.status === "running_low").map((c) => c.itemId)),
    [cabinet.data],
  );
  // Read-only view of the cached estimate (fetched from the Prices screen).
  const prices = usePrices(groupId, { enabled: false }).data;
  /** itemId → "~$3.49" for the rows (from the last estimate). */
  const priceById = useMemo(
    () => new Map((prices?.items ?? []).map((p) => [p.itemId, `~${formatCents(p.typicalCents ?? Math.round((p.lowCents + p.highCents) / 2))}`])),
    [prices],
  );

  const syncing = useMutationState({
    filters: { mutationKey: ["check", groupId], status: "pending" },
    select: (m) => (m.state.variables as { id: string } | undefined)?.id,
  });
  const syncingIds = useMemo(() => new Set(syncing), [syncing]);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { toBuy, checked } = useMemo(() => noteSections(rows), [rows]);
  const toBuyCount = rows.length - checked.length;

  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });
  const toggle = (r: ShoppingListItem) => check.mutate({ id: r.id, checked: !r.checked }, { onError });
  const remove = (r: ShoppingListItem) =>
    del.mutate(r.id, {
      onSuccess: () => toast(`Removed ${r.item.name} from the list`),
      onError: (e) =>
        isPreferenceRowError(e)
          ? toast(`${r.item.name} is on the list because someone wants it. Remove it from their preferences instead.`)
          : onError(e),
    });
  const pick = (item: Item) =>
    add.mutate({ itemId: item.id }, { onSuccess: () => toast(`Added ${item.name} to the list`), onError });
  const scan = (r: ShoppingListItem) => router.push(`/scanner?mode=match-list-item&listItemId=${r.id}`);

  async function finishTrip() {
    const n = checked.length;
    if (!(await confirm("Finish trip?", `Move ${plural(n, "checked item")} to the cabinet?`, "Finish trip"))) return;
    const itemIds = checked.map((r) => r.itemId);
    complete.mutate(undefined, {
      onSuccess: ({ movedToCabinet }) => {
        toast(`${plural(movedToCabinet, "item")} moved to the cabinet`);
        void maybeAskNotificationPermission();
        if (movedToCabinet > 0) router.push(`/expiration-check?itemIds=${itemIds.join(",")}`);
      },
      onError,
    });
  }
  const rowProps = (r: ShoppingListItem) => ({
    row: r,
    meId,
    names,
    runningLow: lowItemIds.has(r.itemId),
    priceText: priceById.get(r.itemId) ?? null,
    syncing: syncingIds.has(r.id),
    onToggle: toggle,
    onDelete: remove,
    onScan: scan,
  });

  let body: React.ReactNode;
  if (list.isPending) {
    body = (
      <View style={styles.center} testID="list-note-loading" accessibilityRole="progressbar" accessibilityLabel="Loading the list">
        <ActivityIndicator color={P.oakInk} />
        <AppText variant="bodyS" style={styles.pencil}>
          Loading the list…
        </AppText>
      </View>
    );
  } else if (list.isError) {
    body = (
      <View style={styles.center} testID="list-note-error">
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      </View>
    );
  } else if (rows.length === 0) {
    body = (
      <View style={styles.center} testID="list-note-empty">
        <AppText variant="bodyL" weight="display" center style={[styles.hand, styles.emptyText]}>
          Nothing to buy — your pantry is stocked!
        </AppText>
      </View>
    );
  } else {
    body = (
      <>
        {toBuy.map((s) => (
          <View key={s.key}>
            <AppText variant="micro" style={styles.section} accessibilityRole="header">
              {s.title}
            </AppText>
            {s.rows.map((r) => (
              <NoteRow key={r.id} {...rowProps(r)} />
            ))}
          </View>
        ))}
        {checked.length > 0 ? (
          <View>
            <AppText variant="micro" style={styles.section} accessibilityRole="header">
              In the cart
            </AppText>
            {checked.map((r) => (
              <NoteRow key={r.id} {...rowProps(r)} />
            ))}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <PaperSheet
      testID="list-note"
      title="List"
      closeLabel="Close shopping list"
      onClose={onClose}
      subheader={
        <>
          {rows.length > 0 ? <PaperCaption strong>{`${toBuyCount} to buy · ${checked.length} in the cart`}</PaperCaption> : null}
          {rows.length > 0 ? (
            <View style={styles.priceRow}>
              <Pressable
                onPress={() => router.push("/prices")}
                accessibilityRole="button"
                accessibilityLabel={
                  prices
                    ? `Estimated total ${formatCentsRange(prices.totalLowCents, prices.totalHighCents, true)}. Open prices`
                    : "Estimate prices"
                }
                style={({ pressed }) => [styles.priceButton, pressed && styles.pressed]}
                testID="list-note-prices"
              >
                <AppText variant="bodyS" weight="bold" style={styles.priceText}>
                  {prices ? `Est. ${formatCentsRange(prices.totalLowCents, prices.totalHighCents, true)}` : "Estimate prices"}
                </AppText>
              </Pressable>
              <AiLabel text="AI estimate" />
            </View>
          ) : null}
          {!connected && !list.isPending ? <PaperCaption>Live updates paused · refreshing every 5 s</PaperCaption> : null}
        </>
      }
      footer={
        rows.length > 0 ? (
          <PaperPrimaryButton
            label={
              complete.isPending
                ? "Finishing…"
                : checked.length === 0
                  ? "Check items off as you shop"
                  : `Finish trip · move ${checked.length} to the cabinet`
            }
            accessibilityHint="Moves the checked items into the pantry"
            disabled={checked.length === 0}
            loading={complete.isPending}
            onPress={() => void finishTrip()}
            testID="finish-trip"
          />
        ) : null
      }
      overlay={<ItemPicker visible={picking} title="Add to the list" onClose={() => setPicking(false)} onPick={pick} />}
    >
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.banner}>
            <RecallBanner groupId={groupId} />
          </View>
          {body}
          {!list.isPending && !list.isError ? (
            <Pressable
              onPress={() => setPicking(true)}
              accessibilityRole="button"
              accessibilityLabel="Add an item to the shopping list"
              style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
              testID="list-note-add"
            >
              <Plus size={20} color={P.green} strokeWidth={2.6} />
              <AppText weight="display" style={[styles.hand, styles.addText]}>
                Add item
              </AppText>
            </Pressable>
          ) : null}
        </ScrollView>
    </PaperSheet>
  );
}

function who(userId: string | null, meId: string | undefined, names: Map<string, string>): string {
  if (!userId) return "someone";
  if (userId === meId) return "you";
  return names.get(userId) ?? "someone";
}

type NoteRowProps = {
  row: ShoppingListItem;
  meId: string | undefined;
  /** userId → display name (members of the active household). */
  names: Map<string, string>;
  runningLow: boolean;
  /** "~$3.49" from the last price estimate, when there is one. */
  priceText: string | null;
  syncing: boolean;
  onToggle: (r: ShoppingListItem) => void;
  onDelete: (r: ShoppingListItem) => void;
  onScan: (r: ShoppingListItem) => void;
};

function NoteRow({ row, meId, names, runningLow, priceText, syncing, onToggle, onDelete, onScan }: NoteRowProps) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const name = row.item.name;
  const wanted = row.checked
    ? `In the cart · checked by ${who(row.checkedBy, meId, names)}`
    : row.reason === "manual"
      ? row.addedBy
        ? `Added by ${who(row.addedBy, meId, names)}`
        : "Added by hand"
      : row.wantedBy.length
        ? `For ${row.wantedBy.map((w) => (w.userId === meId ? "you" : w.displayName)).join(", ")}`
        : null;
  const meta = [row.quantityText, wanted, runningLow && !row.checked ? "Running low at home" : null].filter(Boolean).join(" · ");
  // My allergens first, so the most important badge is read first.
  const flags = [...row.allergenFlags].sort((a, b) => Number(b.userId === meId) - Number(a.userId === meId));
  const agentNote = row.note ? row.note.replace(/^✨\s*/, "") : null;

  return (
    <View style={styles.row} testID={`list-note-row-${row.id}`}>
      <Pressable
        onPress={() => onToggle(row)}
        onLongPress={() => onDelete(row)}
        delayLongPress={450}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.checked }}
        accessibilityLabel={row.checked ? `Uncheck ${name}` : `Check off ${name}`}
        accessibilityHint="Long press to remove it from the list"
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        testID={`list-note-check-${row.id}`}
      >
        <View style={[styles.box, row.checked && styles.boxOn]}>
          {row.checked ? <Check size={18} color={P.notePaper} strokeWidth={3.2} /> : null}
        </View>
        <View style={styles.rowText}>
          <View style={styles.nameLine}>
            <AppText
              variant="bodyL"
              weight="heavy"
              strike={row.checked}
              style={[styles.name, row.checked && styles.checkedText]}
            >
              {name}
            </AppText>
            {priceText ? (
              <AppText variant="bodyS" weight="semi" style={styles.pencil} testID={`list-note-price-${row.id}`}>
                {priceText}
              </AppText>
            ) : null}
            {syncing ? <View style={styles.syncDot} accessible accessibilityLabel="Syncing" /> : null}
          </View>
          {meta ? (
            <AppText variant="caption" strike={row.checked} style={styles.pencil}>
              {meta}
            </AppText>
          ) : null}
          {agentNote ? (
            <View style={styles.agentNote} accessible accessibilityLabel={`AI note: ${agentNote}`}>
              <Sparkles size={12} color={P.oakInk} strokeWidth={2.5} />
              <AppText variant="caption" weight="semi" style={[styles.pencil, styles.name]}>
                {agentNote.charAt(0).toUpperCase() + agentNote.slice(1)}
              </AppText>
            </View>
          ) : null}
          {flags.length > 0 ? (
            <View style={styles.badges}>
              {flags.map((f) => {
                const mine = f.userId === meId;
                const whom = mine ? "you" : f.displayName;
                return (
                  <View
                    key={`${f.userId}-${f.allergen}`}
                    style={[styles.badge, mine ? styles.badgeMine : styles.badgeOther]}
                    accessible
                    accessibilityLabel={`Allergen warning: contains ${allergenLabel(f.allergen).toLowerCase()}, ${mine ? "you are" : `${f.displayName} is`} allergic`}
                    testID={`list-note-allergen-${row.id}-${f.userId}-${f.allergen}`}
                  >
                    <AlertTriangle size={13} color={mine ? "#FFFFFF" : P.redInk} strokeWidth={2.6} />
                    <AppText variant="caption" weight="bold" style={mine ? styles.badgeMineText : styles.badgeOtherText}>
                      {`${allergenLabel(f.allergen)} · ${whom}`}
                    </AppText>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </Pressable>
      {!row.checked ? (
        <Pressable
          onPress={() => onScan(row)}
          accessibilityRole="button"
          accessibilityLabel={`Scan a product for ${name}`}
          style={({ pressed }) => [styles.del, pressed && styles.pressed]}
          testID={`list-note-scan-${row.id}`}
        >
          <ScanBarcode size={18} color={P.muted} />
        </Pressable>
      ) : null}
      {row.reason === "manual" ? (
        <Pressable
          onPress={() => onDelete(row)}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} from the list`}
          style={({ pressed }) => [styles.del, pressed && styles.pressed]}
          testID={`list-note-delete-${row.id}`}
        >
          <X size={18} color={P.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Paper chrome (sheet, rules, sections, hand lettering) is shared with the Week sheet; rows are List-only. */
const makeStyles = (P: OverlayPalette) => ({
  ...makePaperStyles(P),
  ...StyleSheet.create({
  emptyText: { fontSize: 22, lineHeight: 30, transform: [{ rotate: "-1.5deg" }] },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "flex-start", minHeight: RULE, paddingVertical: 6 },
  box: {
    width: 24,
    height: 24,
    marginLeft: 8,
    marginTop: 4,
    marginRight: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: P.oakInk,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-4deg" }],
  },
  boxOn: { backgroundColor: P.green, borderColor: P.green },
  rowText: { flex: 1, gap: 2, paddingRight: 4 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: P.ink, flexShrink: 1 },
  checkedText: { color: P.muted },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.muted },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeMine: { backgroundColor: P.redInk, borderColor: P.redInk },
  badgeOther: { backgroundColor: P.redTint, borderColor: "#F2B8B1" },
  badgeMineText: { color: "#FFFFFF" },
  badgeOtherText: { color: P.redInk },
  del: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: RULE + 4,
    paddingLeft: MARGIN_X - 2,
    borderBottomWidth: 1,
    borderBottomColor: P.noteRule,
  },
  addText: { fontSize: 20, lineHeight: 26, color: P.green },
  agentNote: { flexDirection: "row", alignItems: "center", gap: 4 },
  banner: { paddingLeft: PAPER_MARGIN_X - 4, paddingRight: 12 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: MARGIN_X, marginTop: 8 },
  priceButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: P.green,
  },
  priceText: { color: P.green },
  pressed: { opacity: 0.75 },
  }),
});
