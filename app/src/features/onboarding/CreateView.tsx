import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, TextField } from '@/components/ui';
import { color, space } from '@/theme';

import type { CreateViewProps } from './useOnboarding';

/** DESIGN.md §4.3 Create. */
export function CreateView({ name, onChangeName, onSubmit, busy, onBack }: CreateViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        testID="screen-create"
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.back}>
          <Button label="Back" variant="ghost" size="sm" onPress={onBack} testID="create-back" />
        </View>
        <View style={styles.titleBlock}>
          <AppText variant="h1" accessibilityRole="header">
            Name your household
          </AppText>
          <AppText color="ink2">{"You'll be the owner. You can invite people on the next screen."}</AppText>
        </View>
        <TextField
          label="Household name"
          value={name}
          onChangeText={onChangeName}
          onSubmitEditing={onSubmit}
          returnKeyType="done"
          autoCapitalize="words"
          testID="create-name"
        />
        <Button
          label="Create household"
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={onSubmit}
          testID="create-submit"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 48, gap: space.xxl },
  back: { alignItems: 'flex-start', marginLeft: -14 },
  titleBlock: { gap: space.sm },
});
