import { QueryClient } from '@tanstack/vue-query';
import { HttpError, isNetworkFailure } from '@/api/errors.ts';

const MAX_QUERY_RETRIES = 2;

/**
 * Reads retry a lost network or a 5xx, with backoff, at most twice. A 4xx is
 * an answer, not a hiccup: retrying it only repeats the refusal.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (error instanceof HttpError) return error.status >= 500;
  return isNetworkFailure(error);
}

/**
 * The only cache in the console. No persister: what an operator returned
 * lives in memory and dies with the tab, like the tokens.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
      mutations: {
        // A write is never repeated on the person's behalf (design §9).
        retry: false,
      },
    },
  });
}
