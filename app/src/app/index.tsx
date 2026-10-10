import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useHealth } from '@/api/hooks/useHealth';
import { config } from '@/config';
import { fontSize, minTapTarget, radius, spacing, useColors } from '@/theme';

// Temporary screen for 01: proves the app can reach the API. Replaced by the auth flow in 02.
export default function HealthScreen() {
  const colors = useColors();
  const health = useHealth();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        GrocerEZ
      </Text>
      <Text style={[styles.muted, { color: colors.textMuted }]}>{config.apiUrl}</Text>

      <View style={styles.status}>
        {health.isPending ? (
          <ActivityIndicator accessibilityLabel="Checking server" />
        ) : health.isError ? (
          <>
            <Text style={[styles.body, { color: colors.allergen }]}>Server unreachable: {health.error.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => health.refetch()}
              style={[styles.button, { backgroundColor: colors.primary }]}>
              <Text style={[styles.body, { color: colors.onPrimary }]}>Retry</Text>
            </Pressable>
          </>
        ) : (
          <Text style={[styles.body, { color: colors.inStock }]}>
            /api/health {health.data.ok ? 'OK' : 'not ok'}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: fontSize.heading, fontWeight: '700' },
  muted: { fontSize: fontSize.caption },
  body: { fontSize: fontSize.body, textAlign: 'center' },
  status: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.md },
  button: {
    minHeight: minTapTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    justifyContent: 'center',
  },
});
