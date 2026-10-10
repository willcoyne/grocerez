import { useRouter } from 'expo-router';

import { GroupView } from '@/features/group/GroupView';
import { useHousehold } from '@/features/group/useHousehold';

/** Household tab (DESIGN.md §4.8): data hook + presentational view. */
export default function GroupScreen() {
  const router = useRouter();
  const { retry, ...data } = useHousehold();
  return <GroupView {...data} onRetry={retry} onInvite={() => router.push('/invite')} />;
}
