import { SignInView } from '@/features/onboarding/SignInView';
import { useSignIn } from '@/features/onboarding/useOnboarding';

// DESIGN.md §4.1. Root testID: screen-signin (in SignInView).
export default function SignInScreen() {
  return <SignInView {...useSignIn()} />;
}
