import { useQuery } from '@tanstack/vue-query';
import type { Ref } from 'vue';
import { computed } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { operatorRequest } from '@/api/http.ts';
import { useSession } from '@/auth/session.ts';
import { authConfig } from '@/config.ts';
import { useOperator } from '@/operator/use-operator.ts';

/** One of the person's airdresses, as the hub lists them (`GET /api/airdresses`). */
export interface OwnedAirdress {
  readonly id: string;
  readonly name: string;
  readonly fqdn: string;
  readonly label: string | undefined;
  readonly status: string;
}

function readOwned(r: Reader): OwnedAirdress {
  return {
    id: r.string('id'),
    name: r.string('name'),
    fqdn: r.string('fqdn'),
    label: r.optString('label'),
    status: r.string('status'),
  };
}

export interface OwnedPage {
  readonly items: readonly OwnedAirdress[];
  readonly nextCursor: string | undefined;
}

export function readOwnedPage(body: unknown): OwnedPage {
  const r = R.of('/api/airdresses', body);
  return { items: r.list('items', readOwned), nextCursor: r.optString('next_cursor') };
}

const PAGE = 100;
const MAX_PAGES = 10;

/**
 * Every airdress the person owns, read with a hub-API token (the session
 * must be scoped to the hub's API resource). A person with more than a
 * thousand is shown the first thousand.
 */
export function useOwnedAirdresses(
  enabled: Readonly<Ref<boolean>>,
): ReturnType<typeof useQuery<readonly OwnedAirdress[]>> {
  const session = useSession();
  const op = useOperator();
  const hubHost = new URL(authConfig(window.location.origin, import.meta.env).issuer).host;
  return useQuery({
    queryKey: ['hub', 'airdresses'] as const,
    queryFn: async () => {
      const all: OwnedAirdress[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ limit: String(PAGE) });
        if (cursor !== undefined) query.set('cursor', cursor);
        const body = await operatorRequest(
          session,
          op.fetch,
          hubHost,
          `/api/airdresses?${query.toString()}`,
        );
        const read = readOwnedPage(body);
        all.push(...read.items);
        cursor = read.nextCursor;
        if (cursor === undefined) break;
      }
      return all;
    },
    enabled: computed(() => enabled.value),
  });
}
