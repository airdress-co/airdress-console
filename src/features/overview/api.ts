import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { Reader } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

/** The four switches (SPEC-133); nothing about plans or prices. */
export interface Capabilities {
  readonly agentBus: boolean;
  readonly agentDevices: boolean;
  readonly mcpLocal: boolean;
  readonly mcpRemote: boolean;
}

export function readCapabilities(body: unknown): Capabilities {
  const r = Reader.of('/v1/capabilities', body);
  return {
    agentBus: r.boolean('agent_bus'),
    agentDevices: r.boolean('agent_devices'),
    mcpLocal: r.boolean('mcp_local'),
    mcpRemote: r.boolean('mcp_remote'),
  };
}

export function useCapabilities(): ReturnType<typeof useQuery<Capabilities>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.capabilities(op.fqdn.value ?? '')),
    queryFn: async () => readCapabilities(await op.request('/v1/capabilities')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

/** Reachability: `/readyz` answers 200 when the operator serves. */
export function useReadiness(): ReturnType<typeof useQuery<boolean>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.health(op.fqdn.value ?? '')),
    // `/readyz` answers plain text, so only the status is read.
    queryFn: async () => {
      const response = await op.fetch(`https://${op.requireFqdn()}/readyz`, {
        credentials: 'omit',
        cache: 'no-store',
      });
      return response.ok;
    },
    enabled: computed(() => op.fqdn.value !== undefined),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
