import { CATEGORIES, type Category } from "@contracts/common";
import type { Item } from "@contracts/items";
import { Check, X } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { useCreateItem, useItemSearch } from "@/api/hooks/items";
import { AppText, Button, ErrorState, IconButton, SectionLabel, SuggestBanner, TextField, ToggleChip } from "@/components/ui";
import { labelize } from "@/lib/format";
import { color, pressedOpacity, radius, size, space } from "@/theme";

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
          <AppText variant="tabTitle" accessibilityRole="header" style={styles.flex}>
            {title}
          </AppText>
          <IconButton label="Close" onPress={onClose}>
            <X size={22} color={color.ink2} />
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
  const typed = text.trim();

  return (
    <View style={styles.body}>
      <TextField
        label="Search items"
        placeholder="e.g. milk, cheerios, eggs"
        value={text}
        onChangeText={(t) => {
          setText(t);
          setCreating(false);
        }}
        autoFocus
        autoCapitalize="none"
        returnKeyType="search"
      />
      {header}
      {keepOpen && lastAdded ? (
        <View style={styles.added}>
          <Check size={16} color={color.okFg} strokeWidth={3} />
          <AppText variant="caption" weight="bold" color="okFg">{`Added ${lastAdded}`}</AppText>
        </View>
      ) : null}
      {create.isError ? (
        <AppText variant="caption" weight="bold" color="dangerFg" accessibilityRole="alert">
          {errorMessage(create.error)}
        </AppText>
      ) : null}

      {search.isError ? <ErrorState message={errorMessage(search.error)} onRetry={() => void search.refetch()} /> : null}
      {search.isFetching && !data ? (
        <AppText variant="caption" color="muted">
          Searching…
        </AppText>
      ) : null}

      {creating ? (
        <View style={styles.gap}>
          <AppText variant="body" weight="bold">{`Pick a category for "${typed}"`}</AppText>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <ToggleChip key={c} label={labelize(c)} selected={false} onPress={() => createNew(c)} />
            ))}
          </View>
          {create.isPending ? (
            <AppText variant="caption" color="muted">
              Creating…
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!creating && data && fresh && q ? (
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={rows}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.results}
          ListHeaderComponent={
            suggestion ? (
              <SuggestBanner
                itemName={suggestion.name}
                typed={typed}
                busy={create.isPending}
                onYes={() => create.mutate({ name: typed, aliasOf: suggestion.id }, { onSuccess: pick })}
                onNo={() => setCreating(true)}
              />
            ) : data.match === "none" && rows.length > 0 ? (
              <SectionLabel>Similar items</SectionLabel>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name}`}
              style={({ pressed }) => [styles.result, pressed && { opacity: pressedOpacity }]}
              onPress={() => pick(item)}
            >
              <AppText variant="bodyL" weight="heavy" style={styles.flex}>
                {item.name}
              </AppText>
              {item.category ? (
                <AppText variant="caption" color="muted">
                  {labelize(item.category)}
                </AppText>
              ) : null}
            </Pressable>
          )}
          ListFooterComponent={
            data.match === "none" ? (
              <Button label={`Create "${typed}"`} variant="secondary" fullWidth onPress={() => setCreating(true)} />
            ) : null
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingLeft: space.screenX,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  body: { flex: 1, padding: space.screenX, gap: space.md },
  gap: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  added: { flexDirection: "row", alignItems: "center", gap: space.xs },
  results: { gap: space.sm },
  result: {
    minHeight: size.hit,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
  },
});
