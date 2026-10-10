import { View } from 'react-native';

import { AppText } from '@/components/ui';

// Placeholder (Phase 0). Agent A builds DESIGN.md §4.3.
export default function CreateScreen() {
  return (
    <View testID="screen-create">
      <AppText variant="h1">Name your household</AppText>
    </View>
  );
}
