import { HouseholdView } from '@/features/onboarding/HouseholdView';
import { useHousehold } from '@/features/onboarding/useOnboarding';

// DESIGN.md §4.2. Root testID: screen-household (in HouseholdView).
export default function HouseholdScreen() {
  return <HouseholdView {...useHousehold()} />;
}
