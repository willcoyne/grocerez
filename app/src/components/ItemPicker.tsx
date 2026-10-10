import { CATEGORIES, type Category } from "@contracts/common";
import type { Item } from "@contracts/items";
import { type ReactNode, useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useCreateItem, useItemSearch } from "@/api/hooks/items";
import { labelize } from "@/lib/format";
import { colors, fontSize, spacing, TAP_TARGET } from "@/theme";
import { ErrorState } from "./States";
import { Button, Chip, IconButton, Input } from "./ui";

export interface ItemPickerProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  /** Called with the chosen catalog item. */
  onPick: (item: Item) => void;
  /** "Quick add many" (map-out cabinet): stay open after each pick. */
  keepOpen?: boolean;
  /** Extra controls under the search box (e.g. the cabinet's location selector). */
  header?: ReactNode;
  initialText?: string;
}

/** Debounce a value (250 ms for search). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Search the shared catalog (GET /items/search). exact → tap to add; suggested → "Did you mean X?" [Yes] saves the typed
 * text as an alias, [No] creates a new item; none → similar items + "Create 'X'".
 */
export function ItemPicker({ visible, title = "Add an item", onClose, onPick, keepOpen, header, initialText = "" }: ItemPickerProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <IconButton label="Close" onPress={onClose}>
            <Text style={styles.close}>✕</Text>
          </IconButton>
        </View>
        {visible ? (
          <ItemPickerBody onPick={onPick} onClose={onClose} keepOpen={keepOpen} header={header} initialText={initialText} />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

export function ItemPickerBody({
  onPick,
  onClose,
  keepOpen,
  header,
  initialText = "",
}: Pick<ItemPickerProps, "onPick" | "onClose" | "keepOpen" | "header" | "initialText">) {
  const [text, setText] = useState(initialText);
  const [creating, setCreating] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const q = useDebounced(text.trim());
  const search = useItemSearch(q);
  const create = useCreateItem();

  function pick(item: Item) {
    onPick(item);
    setLastAdded(item.name);
    if (keepOpen) {
      setText("");
      setCreating(false);
    } else {
      onClose();
    }
  }

  function createNew(category?: Category) {
    create.mutate({ name: text.trim(), category }, { onSuccess: pick });
  }

  const data = search.data;
  const suggestion = data?.match === "suggested" ? data.results[0] : null;
  const rows = data ? (data.match === "suggested" ? data.results.slice(1) : data.results) : [];
  const fresh = q === text.trim();

  return (
    <View style={styles.body}>
      <Input
        placeholder="Search: milk, cheerios, eggs…"
        accessibilityLabel="Search items"
        value={text}
        onChangeText={(t) => {
          setText(t);
          setCreating(false);
        }}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
      />
      {header}
      {keepOpen && lastAdded ? <Text style={styles.muted}>Added {lastAdded} ✓</Text> : null}
      {create.isError ? <Text style={styles.error}>{errorMessage(create.error)}</Text> : null}

      {search.isError ? <ErrorState error={search.error} onRetry={() => search.refetch()} /> : null}
      {search.isFetching && !data ? <Text style={styles.muted}>Searching…</Text> : null}

      {creating ? (
        <View style={styles.gap}>
          <Text style={styles.label}>Pick a category for “{text.trim()}”</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={labelize(c)} onPress={() => createNew(c)} />
            ))}
          </View>
          {create.isPending ? <Text style={styles.muted}>Creating…</Text> : null}
        </View>
      ) : null}

      {!creating && data && fresh && q ? (
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={rows}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={
            suggestion ? (
              <View style={styles.suggest} accessibilityRole="alert">
                <Text style={styles.suggestText}>
                  Did you mean <Text style={styles.bold}>{suggestion.name}</Text>?
                </Text>
                <View style={styles.row}>
                  <Button
                    title="Yes"
                    compact
                    accessibilityLabel={`Yes, ${suggestion.name}`}
                    loading={create.isPending}
                    onPress={() => create.mutate({ name: text.trim(), aliasOf: suggestion.id }, { onSuccess: pick })}
                  />
                  <Button title={`No, add “${text.trim()}” as new`} variant="secondary" compact onPress={() => setCreating(true)} />
                </View>
              </View>
            ) : data.match === "none" && rows.length > 0 ? (
              <Text style={styles.muted}>Similar items</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} style={styles.result} onPress={() => pick(item)}>
              <Text style={styles.resultText}>{item.name}</Text>
              {item.category ? <Text style={styles.muted}>{labelize(item.category)}</Text> : null}
            </Pressable>
          )}
          ListFooterComponent={
            data.match === "none" ? (
              <Pressable accessibilityRole="button" style={styles.result} onPress={() => setCreating(true)}>
                <Text style={[styles.resultText, styles.createText]}>＋ Create “{text.trim()}”</Text>
              </Pressable>
            ) : null
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  title: { fontSize: fontSize.xl, fontWeight: "800", color: colors.text },
  close: { fontSize: fontSize.xl, color: colors.textMuted },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },
  gap: { gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  error: { fontSize: fontSize.sm, color: colors.danger },
  suggest: { backgroundColor: colors.warningLight, padding: spacing.md, borderRadius: 10, gap: spacing.sm, marginBottom: spacing.sm },
  suggestText: { fontSize: fontSize.md, color: colors.text },
  bold: { fontWeight: "700" },
  result: {
    minHeight: TAP_TARGET,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resultText: { fontSize: fontSize.md, color: colors.text },
  createText: { color: colors.primary, fontWeight: "700" },
});
