import { View } from 'react-native';

import { ScreenHeader } from '@/components/ui';

// Placeholder (Phase 0). Agent B builds DESIGN.md §4.5.
export default function ListScreen() {
  return (
    <View testID="tab-list">
      <ScreenHeader title="Shopping list" />
    </View>
  );
}
