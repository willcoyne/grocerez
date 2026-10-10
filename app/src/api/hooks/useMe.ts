import type { User } from '@contracts/models';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/state/AuthContext';

import { api } from '../client';
import { qk } from '../keys';

/**
 * useMe(): UseQueryResult<User>   // GET /me; disabled while signed out. Seeded by sign-in, so usually instant.
 */
export function useMe() {
  const { token } = useAuth();
  return useQuery({ queryKey: qk.me(), queryFn: () => api<User>('/me'), enabled: !!token });
}
