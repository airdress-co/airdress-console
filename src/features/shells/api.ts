import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

export interface ShellHost {
  readonly name: string;
  readonly principal: string | undefined;
  readonly machine: string | undefined;
  readonly enabled: boolean;
  readonly linked: boolean;
  readonly connected: boolean;
}

function readHost(r: Reader): ShellHost {
  return {
    name: r.string('name'),
    principal: r.optString('principal'),
    machine: r.optString('machine'),
    enabled: r.optBoolean('enabled') ?? false,
    linked: r.optBoolean('linked') ?? false,
    connected: r.optBoolean('connected') ?? false,
  };
}

export const readShellHosts = (body: unknown): readonly ShellHost[] =>
  R.of('/v1/admin/shells', body).list('hosts', readHost);

/** Shells are behind a kill switch: off, every route answers `403 not_enabled`. */
export function useShellHosts(): ReturnType<typeof useQuery<readonly ShellHost[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.shells(op.fqdn.value ?? '')),
    queryFn: async () => readShellHosts(await op.request('/v1/admin/shells')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export function useRevokeShellHost(): ReturnType<typeof useMutation<unknown, Error, string>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (host: string) =>
      op.request(`/v1/admin/shells/${encodeURIComponent(host)}/revoke`, { method: 'POST' }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.shells(op.fqdn.value ?? '') }),
  });
}
