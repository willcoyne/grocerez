import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './client';

// Client errors (4xx) won't succeed on retry; network and server errors might.
const retryable = (error: unknown) => !(error instanceof ApiError && error.status >= 400 && error.status < 500);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => count < 2 && retryable(error),
    },
    mutations: {
      // Check-offs need to survive bad signal inside the store.
      retry: (count, error) => count < 3 && retryable(error),
    },
  },
});
