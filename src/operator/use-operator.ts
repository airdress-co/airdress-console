import { useQuery } from '@tanstack/vue-query';
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue';
import { computed, inject, toValue } from 'vue';
import type { Fetch } from '@/api/http.ts';
import { operatorRequest, publicRequest } from '@/api/http.ts';
import { Reader } from '@/api/guards.ts';
import { useSession } from '@/auth/session.ts';
import type { Area } from '@/compat.ts';
import { supports } from '@/compat.ts';
import { operatorKeys } from '@/query/keys.ts';
import { operatorOrigin } from '@/config.ts';
import { fqdnOf } from './connection.ts';

/** The fetch the operator calls go through; tests provide their own. */
export const FetchKey: InjectionKey<Fetch> = Symbol('fetch');

export interface OperatorApi {
  /** The connected operator, from the session's resource. */
  readonly fqdn: ComputedRef<string | undefined>;
  /** The connected operator, or a thrown error when none is (guarded routes only). */
  requireFqdn(): string;
  /** Where the connected operator's API is reached. */
  origin(): string;
  request(path: string, init?: RequestInit): Promise<unknown>;
  readonly fetch: Fetch;
}

function defaultFetch(input: string, init: RequestInit): Promise<Response> {
  return window.fetch(input, init);
}

export function useOperator(): OperatorApi {
  const session = useSession();
  const fetchImpl = inject(FetchKey, defaultFetch);
  const fqdn = computed(() => fqdnOf(session.resource.value));
  function requireFqdn(): string {
    const current = fqdn.value;
    if (current === undefined) throw new Error('not connected to an operator');
    return current;
  }
  return {
    fqdn,
    requireFqdn,
    origin: () => operatorOrigin(requireFqdn()),
    request: (path, init) =>
      operatorRequest(session, fetchImpl, operatorOrigin(requireFqdn()), path, init),
    fetch: fetchImpl,
  };
}

export interface ClientConfig {
  readonly operatorName: string | undefined;
  readonly operatorVersion: string | undefined;
}

export function readClientConfig(body: unknown): ClientConfig {
  const r = Reader.of('/v1/chat/clients/config', body);
  return {
    operatorName: r.optString('operator_name'),
    operatorVersion: r.optString('operator_version'),
  };
}

/** The operator's own name and version: unauthenticated and cheap (design §7). */
export function useClientConfig(): ReturnType<typeof useQuery<ClientConfig>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.clientConfig(op.fqdn.value ?? '')),
    queryFn: async () =>
      readClientConfig(await publicRequest(op.fetch, `${op.origin()}/v1/chat/clients/config`)),
    enabled: computed(() => op.fqdn.value !== undefined),
    staleTime: 5 * 60_000,
  });
}

/** Whether this operator serves an area: true, false, or undefined while unknown. */
export function useAreaSupport(area: MaybeRefOrGetter<Area>): ComputedRef<boolean | undefined> {
  const config = useClientConfig();
  return computed(() => supports(config.data.value?.operatorVersion, toValue(area)));
}
