import type { Recipe } from "@contracts/ai";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { api, ApiError, errorMessage } from "@/api/client";
import { useSuggestRecipes } from "@/api/hooks/ai";
import { useDietary } from "@/api/hooks/me";
import { useHouseholdAllergens } from "@/api/hooks/products";
import { useAddListItem } from "@/api/hooks/shoppingList";
import type { Item } from "@contracts/items";
import { useToast } from "@/components/Toast";
import { AiLabel, Button, Card, Chip } from "@/components/ui";
import { labelize } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { colors, fontSize, radius, spacing } from "@/theme";

function recipeError(e: unknown): string {
  if (e instanceof ApiError && e.code === "CABINET_EMPTY") return "Add some items to your cabinet first, then try again.";
  if (e instanceof ApiError && (e.code === "AI_UNAVAILABLE" || e.code === "NOT_CONFIGURED" || e.code === "AI_BAD_OUTPUT")) {
    return "Recipe ideas are unavailable right now.";
  }
  return errorMessage(e);
}

/** AI recipe suggestions from what's in the cabinet (Claude). */
export default function RecipesScreen() {
  const groupId = useRequiredGroupId();
  const suggest = useSuggestRecipes(groupId);
  const dietary = useDietary();
  const household = useHouseholdAllergens(groupId);
  const [useExpiring, setUseExpiring] = useState(true);

  const safeFor = [
    ...(dietary.data?.diets ?? []).map(labelize),
    ...[...household.keys()].map((a) => `no ${labelize(a).toLowerCase()}`),
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <AiLabel text="AI recipe ideas" />
      <View style={styles.toggle}>
        <Text style={styles.body}>Use expiring items first</Text>
        <Switch value={useExpiring} onValueChange={setUseExpiring} accessibilityLabel="Use expiring items first" />
      </View>
      {safeFor.length > 0 ? <Text style={styles.muted}>Safe for: {safeFor.join(" · ")}</Text> : null}
      <Button
        title={suggest.data ? "Suggest again" : "Find recipes"}
        loading={suggest.isPending}
        onPress={() => suggest.mutate({ mustUseExpiring: useExpiring, maxRecipes: 3 })}
      />

      {suggest.isPending ? (
        <View style={styles.gap} accessibilityLabel="Looking through your cabinet">
          <Text style={styles.muted}>Looking through your cabinet… (this can take 10–20 seconds)</Text>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </View>
      ) : null}
      {suggest.isError ? (
        <Card>
          <Text style={styles.error} accessibilityRole="alert">
            {recipeError(suggest.error)}
          </Text>
        </Card>
      ) : null}
      {suggest.data?.length === 0 ? <Text style={styles.muted}>No safe recipes found. Try turning off “Use expiring items first”.</Text> : null}
      {suggest.data?.map((r) => <RecipeCard key={r.title} recipe={r} groupId={groupId} />)}
    </ScrollView>
  );
}

function RecipeCard({ recipe, groupId }: { recipe: Recipe; groupId: string }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const addList = useAddListItem(groupId);
  const toast = useToast();
  const expiring = new Set(recipe.usesExpiring.map((s) => s.toLowerCase()));

  /** Add missing to list: catalog matches directly; unmatched names are created first (POST /items) then added. */
  async function addMissing() {
    setAdding(true);
    let added = 0;
    try {
      for (const m of recipe.missingItems) {
        const itemId = m.itemId ?? (await api<Item>("/items", { method: "POST", body: { name: m.name } })).id;
        await addList.mutateAsync({ itemId });
        added += 1;
      }
      toast(`${added} item${added === 1 ? "" : "s"} added to the list`);
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.title}>{recipe.title}</Text>
        <AiLabel text="AI" />
      </View>
      <Text style={styles.muted}>
        {recipe.minutes} min · serves {recipe.servings}
      </Text>
      <Text style={styles.body}>{recipe.summary}</Text>
      <View style={styles.chips}>
        <Text style={styles.label}>Uses:</Text>
        {recipe.usesCabinetItems.map((u) => (
          <Chip key={u} label={expiring.has(u.toLowerCase()) ? `⏰ ${u}` : u} tone={expiring.has(u.toLowerCase()) ? "warning" : "success"} accessibilityLabel={expiring.has(u.toLowerCase()) ? `${u}, expiring soon` : u} />
        ))}
      </View>
      {recipe.missingItems.length > 0 ? (
        <Text style={styles.body}>
          <Text style={styles.label}>Missing: </Text>
          {recipe.missingItems.map((m) => m.itemName ?? m.name).join(", ")}
        </Text>
      ) : null}
      {recipe.allergenWarnings.map((w) => (
        <Text key={w} style={styles.error}>
          ⚠ {w}
        </Text>
      ))}
      <Button title={open ? "Hide steps" : "Show steps"} variant="ghost" compact onPress={() => setOpen(!open)} />
      {open ? (
        <View style={styles.gap}>
          <Text style={styles.label}>Ingredients</Text>
          {recipe.ingredients.map((i) => (
            <Text key={i} style={styles.body}>
              • {i}
            </Text>
          ))}
          <Text style={styles.label}>Steps</Text>
          {recipe.steps.map((s, idx) => (
            <Text key={idx} style={styles.body}>
              {idx + 1}. {s}
            </Text>
          ))}
        </View>
      ) : null}
      {recipe.missingItems.length > 0 ? (
        <Button title="Add missing to list" variant="secondary" loading={adding} onPress={() => void addMissing()} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  gap: { gap: spacing.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  title: { fontSize: fontSize.lg, fontWeight: "800", color: colors.text, flex: 1 },
  label: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },
  body: { fontSize: fontSize.md, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  error: { fontSize: fontSize.md, color: colors.danger },
  skeleton: { height: 120, borderRadius: radius.lg, backgroundColor: colors.border },
});
