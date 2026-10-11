/**
 * The shopping list as a paper notepad (SPEC.md round 2): opens after the camera flies to the note pinned on the pantry
 * and the paper lifts off its pin. Plain React Native (works on web + native), layered over the canvas.
 *
 * Thin client: rows, aisle order, allergen flags and the "preference rows can't be deleted" rule all come from the
 * server; this view only groups what it gets (unchecked by category in server order, checked at the bottom).
 */
import type { Item } from "@contracts/items";
import type { ShoppingListItem } from "@contracts/shoppingList";
import { useMutationState } from "@tanstack/react-query";
import { AlertTriangle, Check, Plus, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, errorMessage } from "@/api/client";
import { useAddListItem, useCheckItem, useDeleteListItem, useShoppingList } from "@/api/hooks/shoppingList";
import { ItemPicker } from "@/components/ItemPicker";
import { AppText, ErrorState, useToast } from "@/components/ui";
import { labelize } from "@/lib/format";
import { useSocketConnected } from "@/realtime/SocketProvider";
import { useAuth } from "@/state/AuthContext";
import { font } from "@/theme";

import { allergenLabel, type OverlayPalette, shadowFor, useOverlayPalette, useOverlayStyles } from "./palette";

export type ShoppingListNoteProps = {
  visible: boolean;
  groupId: string;
  onClose: () => void;
  /** "Start shopping" (PantryScreen pushes /shopping). */
  onStartShopping: () => void;
};

const RULE = 44; // row rhythm (also the minimum tap height)
const MARGIN_X = 50;

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

export function ShoppingListNote({ visible, groupId, onClose, onStartShopping }: ShoppingListNoteProps) {
  if (!visible) return null;
  return <NoteSheet groupId={groupId} onClose={onClose} onStartShopping={onStartShopping} />;
}

function NoteSheet({ groupId, onClose, onStartShopping }: Omit<ShoppingListNoteProps, "visible">) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const connected = useSocketConnected();
  // Live sync comes from the socket; while it's down, poll every 5 s while the note is open.
  const list = useShoppingList(groupId, { refetchInterval: connected ? false : 5000 });
  const check = useCheckItem(groupId);
  const add = useAddListItem(groupId);
  const del = useDeleteListItem(groupId);
  const { user } = useAuth();
  const meId = user?.id;
  const { show: toast } = useToast();
  const [picking, setPicking] = useState(false);

  const syncing = useMutationState({
    filters: { mutationKey: ["check", groupId], status: "pending" },
    select: (m) => (m.state.variables as { id: string } | undefined)?.id,
  });
  const syncingIds = useMemo(() => new Set(syncing), [syncing]);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { toBuy, checked } = useMemo(() => noteSections(rows), [rows]);
  const toBuyCount = rows.length - checked.length;

  // Paper "lands" from the lifted 3D note: fade + settle.
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 8, tension: 70 }).start();
  }, [appear]);

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
              <NoteRow key={r.id} row={r} meId={meId} syncing={syncingIds.has(r.id)} onToggle={toggle} onDelete={remove} />
            ))}
          </View>
        ))}
        {checked.length > 0 ? (
          <View>
            <AppText variant="micro" style={styles.section} accessibilityRole="header">
              In the cart
            </AppText>
            {checked.map((r) => (
              <NoteRow key={r.id} row={r} meId={meId} syncing={syncingIds.has(r.id)} onToggle={toggle} onDelete={remove} />
            ))}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} testID="list-note">
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close shopping list"
        testID="list-note-backdrop"
      />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { top: insets.top + 18, bottom: insets.bottom + 12 },
          {
            opacity: appear,
            transform: [
              { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
              { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              { rotate: appear.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", "-0.6deg"] }) },
            ],
          },
        ]}
      >
        <View style={styles.margin} pointerEvents="none" />
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <AppText weight="display" style={styles.title} accessibilityRole="header">
              List
            </AppText>
            <View style={styles.squiggle} />
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close shopping list"
            hitSlop={6}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            testID="list-note-close"
          >
            <X size={22} color={P.oakInk} />
          </Pressable>
        </View>
        {rows.length > 0 ? (
          <AppText variant="bodyS" weight="semi" style={[styles.pencil, styles.count]}>
            {`${toBuyCount} to buy · ${checked.length} in the cart`}
          </AppText>
        ) : null}
        {!connected && !list.isPending ? (
          <AppText variant="caption" style={[styles.pencil, styles.count]}>
            Live updates paused · refreshing every 5 s
          </AppText>
        ) : null}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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

        {toBuyCount > 0 ? (
          <Pressable
            onPress={onStartShopping}
            accessibilityRole="button"
            accessibilityLabel="Start shopping"
            accessibilityHint="Opens the store aisle to shop this list"
            style={({ pressed }) => [styles.shop, pressed && styles.pressed]}
            testID="list-note-start-shopping"
          >
            <AppText weight="bold" style={styles.shopText}>
              Start shopping 🛒
            </AppText>
          </Pressable>
        ) : null}

        {/* the pin the paper came off */}
        <View style={styles.pin} pointerEvents="none">
          <View style={styles.pinShine} />
        </View>
      </Animated.View>

      <ItemPicker visible={picking} title="Add to the list" onClose={() => setPicking(false)} onPick={pick} />
    </View>
  );
}

function NoteRow({
  row,
  meId,
  syncing,
  onToggle,
  onDelete,
}: {
  row: ShoppingListItem;
  meId: string | undefined;
  syncing: boolean;
  onToggle: (r: ShoppingListItem) => void;
  onDelete: (r: ShoppingListItem) => void;
}) {
  const P = useOverlayPalette();
  const styles = useOverlayStyles(makeStyles);
  const name = row.item.name;
  const wanted =
    row.reason === "manual"
      ? "Added by hand"
      : row.wantedBy.length
        ? `For ${row.wantedBy.map((w) => (w.userId === meId ? "you" : w.displayName)).join(", ")}`
        : null;
  const meta = [row.quantityText, wanted].filter(Boolean).join(" · ");
  // My allergens first, so the most important badge is read first.
  const flags = [...row.allergenFlags].sort((a, b) => Number(b.userId === meId) - Number(a.userId === meId));

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
            {syncing ? <View style={styles.syncDot} accessible accessibilityLabel="Syncing" /> : null}
          </View>
          {meta ? (
            <AppText variant="caption" strike={row.checked} style={styles.pencil}>
              {meta}
            </AppText>
          ) : null}
          {flags.length > 0 ? (
            <View style={styles.badges}>
              {flags.map((f) => {
                const mine = f.userId === meId;
                const who = mine ? "you" : f.displayName;
                return (
                  <View
                    key={`${f.userId}-${f.allergen}`}
                    style={[styles.badge, mine ? styles.badgeMine : styles.badgeOther]}
                    accessible
                    accessibilityLabel={`Allergen warning: contains ${allergenLabel(f.allergen).toLowerCase()}, ${mine ? "you are" : `${f.displayName} is`} allergic`}
                    testID={`list-note-allergen-${row.id}-${f.userId}-${f.allergen}`}
                  >
                    <AlertTriangle size={13} color={mine ? P.onDanger : P.redInk} strokeWidth={2.6} />
                    <AppText variant="caption" weight="bold" style={mine ? styles.badgeMineText : styles.badgeOtherText}>
                      {`${allergenLabel(f.allergen)} · ${who}`}
                    </AppText>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </Pressable>
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

const makeStyles = (P: OverlayPalette) =>
  StyleSheet.create({
    backdrop: { backgroundColor: P.backdrop },
    sheet: {
      position: "absolute",
      left: 14,
      right: 14,
      backgroundColor: P.notePaper,
      borderRadius: P.r(6),
      borderWidth: P.pixel ? P.frame : 0,
      borderColor: P.border,
      paddingTop: 26,
      overflow: "visible",
      ...shadowFor(P),
    },
    margin: { position: "absolute", top: 0, bottom: 0, left: MARGIN_X - 10, width: 2, backgroundColor: P.noteMargin },
    header: { flexDirection: "row", alignItems: "flex-start", paddingLeft: MARGIN_X, paddingRight: 8 },
    titleWrap: { flex: 1, paddingTop: 4 },
    title: {
      fontFamily: font.display,
      fontSize: 40,
      lineHeight: 46,
      color: P.oakInk,
      transform: [{ rotate: "-3deg" }],
    },
    squiggle: {
      width: 84,
      height: 4,
      borderRadius: 2,
      backgroundColor: P.oakInk,
      opacity: 0.7,
      marginTop: 2,
      transform: [{ rotate: "-2deg" }],
    },
    close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    count: { paddingLeft: MARGIN_X, paddingRight: 16, marginTop: 6 },
    scroll: { flex: 1, marginTop: 8 },
    scrollContent: { paddingBottom: 24 },
    center: { flexGrow: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 10, paddingLeft: MARGIN_X, paddingRight: 20 },
    hand: { fontFamily: font.display, color: P.oakInk },
    emptyText: { fontSize: 22, lineHeight: 30, transform: [{ rotate: "-1.5deg" }] },
    pencil: { color: P.muted },
    section: {
      color: P.oakDark,
      paddingLeft: MARGIN_X,
      paddingTop: 14,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: P.noteRule,
      letterSpacing: 1.2,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      minHeight: RULE,
      borderBottomWidth: 1,
      borderBottomColor: P.noteRule,
    },
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
      borderRadius: P.r(12),
      borderWidth: 1,
    },
    badgeMine: { backgroundColor: P.redInk, borderColor: P.redInk },
    badgeOther: { backgroundColor: P.redTint, borderColor: P.redBorder },
    badgeMineText: { color: P.onDanger },
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
    shop: {
      minHeight: 54,
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 16,
      borderRadius: P.r(27),
      backgroundColor: P.green,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
      paddingVertical: 12,
      ...shadowFor(P),
    },
    shopText: { color: P.onAccent, fontSize: 18, lineHeight: 24 },
    pressed: { opacity: 0.75 },
    pin: {
      position: "absolute",
      top: -10,
      alignSelf: "center",
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: P.notePin,
      ...shadowFor(P),
    },
    pinShine: { position: "absolute", top: 5, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: P.notePinShine },
  });
