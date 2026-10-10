import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { color, radius, space } from '@/theme';

/** Shown at the top of the Cabinet when "Ran out" returns requeued:false (DESIGN.md §4.6). */
export function RanOutPrompt({
  name,
  busy,
  onAdd,
  onDismiss,
}: {
  name: string;
  busy?: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.card} accessibilityLiveRegion="polite" testID="ranout-prompt">
      <AppText variant="bodyL" weight="heavy">
        {`Nobody has ${name} in their preferences. Add it to the shopping list anyway?`}
      </AppText>
      <View style={styles.actions}>
        <Button
          label="Add to list"
          variant="primary"
          size="sm"
          loading={busy}
          accessibilityLabel={`Add ${name} to the shopping list`}
          onPress={onAdd}
          testID="ranout-prompt-add"
        />
        <Button label="No thanks" variant="secondary" size="sm" disabled={busy} onPress={onDismiss} testID="ranout-prompt-dismiss" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.suggestBg,
    borderWidth: 1,
    borderColor: color.suggestBorder,
    borderRadius: radius.control,
    padding: space.md,
    gap: space.md,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
