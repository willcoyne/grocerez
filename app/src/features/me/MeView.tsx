import { allergenValues, dietValues } from '@contracts/dietary';
import type { Recurrence } from '@contracts/models';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  DashedEmpty,
  ErrorState,
  LoadingState,
  ScreenHeader,
  SectionLabel,
  Segmented,
  ToggleChip,
} from '@/components/ui';
import { ItemAddField } from '@/features/items/ItemAddField';
import { humanize } from '@/lib/format';
import { space } from '@/theme';

import { PreferenceRow } from './PreferenceRow';
import type { MeScreenModel } from './useMeScreen';

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'staple', label: 'Staple' },
  { value: 'one_time', label: 'This week only' },
];

const HINT: Record<Recurrence, string> = {
  staple: 'Staples come back on the list every time you run out.',
  one_time: "One-time items leave your list after they're bought.",
};

/** Me tab (DESIGN.md §4.7): presentational, driven by useMeScreen(). */
export function MeView({ model }: { model: MeScreenModel }) {
  const { prefs, dietary } = model;
  return (
    <View style={styles.root} testID="tab-me">
      <ScreenHeader groupName={model.groupName} memberCount={model.memberCount} title="My preferences" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionLabel>What I want from the store</SectionLabel>
        <ItemAddField
          label="Add an item"
          placeholder="e.g. cheerios"
          buttonVariant="primary"
          testID="me-add"
          onItem={model.addItem}
        />
        <Segmented options={RECURRENCE_OPTIONS} value={model.recurrence} onChange={model.setRecurrence} testID="me-recurrence" />
        <AppText variant="caption" color="muted">
          {HINT[model.recurrence]}
        </AppText>

        <View style={styles.list}>
          {prefs.state === 'pending' ? (
            <LoadingState testID="me-prefs-loading" />
          ) : prefs.state === 'error' ? (
            <ErrorState onRetry={prefs.retry} testID="me-prefs-error" />
          ) : prefs.rows.length === 0 ? (
            <DashedEmpty testID="me-prefs-empty">
              Nothing yet. Add the things you want kept in stock, or just need this week.
            </DashedEmpty>
          ) : (
            prefs.rows.map((row) => (
              <PreferenceRow
                key={row.id}
                row={row}
                onToggleRecurrence={() => model.toggleRecurrence(row)}
                onRemove={() => model.remove(row)}
              />
            ))
          )}
        </View>

        {dietary.state === 'pending' ? (
          <LoadingState testID="me-dietary-loading" />
        ) : dietary.state === 'error' ? (
          <ErrorState onRetry={dietary.retry} testID="me-dietary-error" />
        ) : (
          <>
            <SectionLabel style={styles.section}>Diet</SectionLabel>
            <View style={styles.chips}>
              {dietValues.map((d) => (
                <ToggleChip
                  key={d}
                  label={humanize(d)}
                  selected={!!dietary.value?.diets.includes(d)}
                  onPress={() => dietary.toggleDiet(d)}
                  testID={`diet-${d}`}
                />
              ))}
            </View>
            <SectionLabel style={styles.section}>Allergies</SectionLabel>
            <View style={styles.chips}>
              {allergenValues.map((a) => (
                <ToggleChip
                  key={a}
                  label={humanize(a)}
                  selected={!!dietary.value?.allergens.includes(a)}
                  onPress={() => dietary.toggleAllergen(a)}
                  testID={`allergen-${a}`}
                />
              ))}
            </View>
          </>
        )}
        <AppText variant="caption" color="muted">
          {"Your allergies are flagged on the household's shopping list, with your name."}
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.screenX, paddingVertical: space.xl, gap: space.md },
  list: { gap: space.sm, marginTop: space.xs },
  section: { marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
