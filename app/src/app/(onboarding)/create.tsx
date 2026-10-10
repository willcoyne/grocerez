import { CreateView } from '@/features/onboarding/CreateView';
import { useCreateHousehold } from '@/features/onboarding/useOnboarding';

// DESIGN.md §4.3. Root testID: screen-create (in CreateView).
export default function CreateScreen() {
  return <CreateView {...useCreateHousehold()} />;
}
