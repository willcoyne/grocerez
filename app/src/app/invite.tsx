import { InviteView } from '@/features/onboarding/InviteView';
import { useInviteScreen } from '@/features/onboarding/useOnboarding';

// DESIGN.md §4.4. Root testID: screen-invite (in InviteView).
export default function InviteScreen() {
  return <InviteView {...useInviteScreen()} />;
}
