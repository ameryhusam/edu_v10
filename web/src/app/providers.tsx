/**
 * Every cross-cutting provider, composed once.
 *
 * Order matters: i18n wraps everything because an error boundary needs to
 * translate its own message, and the session sits inside the query client
 * because signing out clears the cache.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { I18nProvider } from '../shared/i18n/i18n';
import { SessionProvider } from '../shared/auth/session';
import { ThemeProvider } from '../shared/theme/theme';
import { ApiError } from '../shared/api/errors';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * Educational state is derived from evidence and changes when the
         * learner acts — not on a timer. A short stale window avoids
         * refetching the same mastery six times while a dashboard mounts,
         * without ever serving a number the learner's own answer invalidated:
         * answering explicitly invalidates (see INVALIDATED_BY_ANSWER).
         */
        staleTime: 30_000,
        gcTime: 5 * 60_000,

        /**
         * Never retry a refusal.
         *
         * A 403 or a 422 is a decision, and asking again produces the same
         * decision three times more slowly. Only transport failures and 5xx
         * are worth a second attempt.
         */
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            if (error.kind === 'OFFLINE') return failureCount < 2;
            if (error.status >= 500) return failureCount < 2;
            return false;
          }
          return false;
        },

        refetchOnWindowFocus: false,
      },
      mutations: {
        // A mutation is a user intent. Replaying it automatically could submit
        // the same answer twice.
        retry: false,
      },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  // Created in state so React's strict-mode double render does not build two
  // clients and split the cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>{children}</SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
