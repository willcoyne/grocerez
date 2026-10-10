import { Redirect } from 'expo-router';

import { useActiveGroup } from '@/state/ActiveGroupContext';
import { useAuth } from '@/state/AuthContext';

/** Entry point: sends the user where the route guard allows (DESIGN.md §1). */
export default function Index() {
  const { token } = useAuth();
  const { groups } = useActiveGroup();
  if (!token) return <Redirect href="/sign-in" />;
  if (!groups?.length) return <Redirect href="/household" />;
  return <Redirect href="/list" />;
}
