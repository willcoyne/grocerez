import type { Recipe } from "@contracts/ai";
import { useState } from "react";
import { Clock, TriangleAlert } from "lucide-react-native";
import { ScrollView, StyleSheet, Switch, View } from "react-native";

import { api, ApiError, errorMessage } from "@/api/client";
import { useSuggestRecipes } from "@/api/hooks/ai";
import { useDietary } from "@/api/hooks/me";
import { useHouseholdAllergens } from "@/api/hooks/products";
import { useAddListItem } from "@/api/hooks/shoppingList";
import type { Item } from "@contracts/items";
import { AiLabel, AppText, Button, Card, DashedEmpty, SectionLabel, StatusChip, useToast } from "@/components/ui";
import { labelize } from "@/lib/format";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color, radius, space } from "@/theme";

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
      <Card style={styles.toggle}>
        <AppText weight="semi" style={styles.flex}>
          Use expiring items first
        </AppText>
        <Switch
          value={useExpiring}
          onValueChange={setUseExpiring}
          accessibilityLabel="Use expiring items first"
          trackColor={{ true: color.primary, false: color.borderStrong }}
          thumbColor={color.surface}
        />
      </Card>
      {safeFor.length > 0 ? (
        <AppText variant="caption" color="muted">{`Safe for: ${safeFor.join(" · ")}`}</AppText>
      ) : null}
      <Button
        label={suggest.data ? "Suggest again" : "Find recipes"}
        size="lg"
        fullWidth
        loading={suggest.isPending}
        onPress={() => suggest.mutate({ mustUseExpiring: useExpiring, maxRecipes: 3 })}
      />

      {suggest.isPending ? (
        <View style={styles.gap} accessibilityLabel="Looking through your cabinet">
          <AppText variant="caption" color="muted">
            Looking through your cabinet. This can take 10 to 20 seconds.
          </AppText>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </View>
      ) : null}
      {suggest.isError ? (
        <DashedEmpty>
          <AppText color="dangerFg" weight="bold" center accessibilityRole="alert">
            {recipeError(suggest.error)}
          </AppText>
        </DashedEmpty>
      ) : null}
      {suggest.data?.length === 0 ? (
        <DashedEmpty>{`No safe recipes found. Try turning off "Use expiring items first".`}</DashedEmpty>
      ) : null}
      {suggest.data?.map((r) => <RecipeCard key={r.title} recipe={r} groupId={groupId} />)}
    </ScrollView>
  );
}

function RecipeCard({ recipe, groupId }: { recipe: Recipe; groupId: string }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const addList = useAddListItem(groupId);
  const { show: toast } = useToast();
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
    <Card style={styles.card}>
      <View style={styles.rowBetween}>
        <AppText variant="bodyL" weight="heavy" style={styles.flex}>
          {recipe.title}
        </AppText>
        <AiLabel text="AI" />
      </View>
      <AppText variant="caption" color="muted">
        {`${recipe.minutes} min · serves ${recipe.servings}`}
      </AppText>
      <AppText color="ink2">{recipe.summary}</AppText>
      <SectionLabel>Uses</SectionLabel>
      <View style={styles.chips}>
        {recipe.usesCabinetItems.map((u) => {
          const soon = expiring.has(u.toLowerCase());
          return (
            <StatusChip
              key={u}
              label={u}
              tone={soon ? "warn" : "ok"}
              icon={soon ? Clock : undefined}
              accessibilityLabel={soon ? `${u}, expiring soon` : u}
            />
          );
        })}
      </View>
      {recipe.missingItems.length > 0 ? (
        <AppText variant="bodyS" color="ink2">
          <AppText variant="bodyS" weight="bold">
            {"Missing: "}
          </AppText>
          {recipe.missingItems.map((m) => m.itemName ?? m.name).join(", ")}
        </AppText>
      ) : null}
      {recipe.allergenWarnings.map((w) => (
        <View key={w} style={styles.warning}>
          <TriangleAlert size={16} color={color.dangerFg} />
          <AppText variant="bodyS" weight="bold" color="dangerFg" style={styles.flex}>
            {w}
          </AppText>
        </View>
      ))}
      <Button label={open ? "Hide steps" : "Show steps"} variant="ghost" size="sm" onPress={() => setOpen(!open)} style={styles.start} />
      {open ? (
        <View style={styles.gap}>
          <SectionLabel>Ingredients</SectionLabel>
          {recipe.ingredients.map((i) => (
            <AppText key={i}>{`· ${i}`}</AppText>
          ))}
          <SectionLabel>Steps</SectionLabel>
          {recipe.steps.map((s, idx) => (
            <AppText key={idx}>{`${idx + 1}. ${s}`}</AppText>
          ))}
        </View>
      ) : null}
      {recipe.missingItems.length > 0 ? (
        <Button label="Add missing to list" variant="secondary" fullWidth loading={adding} onPress={() => void addMissing()} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.screenX, gap: space.md, paddingBottom: space.xxl * 2 },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56 },
  card: { gap: space.sm },
  gap: { gap: space.sm },
  flex: { flex: 1 },
  start: { alignSelf: "flex-start" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  warning: { flexDirection: "row", alignItems: "center", gap: space.xs },
  skeleton: { height: 120, borderRadius: radius.card, backgroundColor: color.segment },
});
