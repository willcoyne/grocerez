import { View } from 'react-native';

import { ScreenHeader } from '@/components/ui';

// Placeholder (Phase 0). Agent D builds DESIGN.md §4.7.
export default function MeScreen() {
  return (
    <View testID="tab-me">
      <ScreenHeader title="My preferences" />
    </View>
  );
}
