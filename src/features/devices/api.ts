import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

export interface Device {
  readonly id: string;
  readonly label: string | undefined;
  readonly principalId: string | undefined;
  readonly createdAt: string;
  readonly lastSeenAt: string | undefined;
  readonly deviceClass: string | undefined;
  readonly harness: string | undefined;
  readonly delegationOnly: boolean;
}

function labelOf(r: Reader): string | undefined {
  const metadata = r.optRecord('metadata');
  return metadata?.optString('device_label') ?? metadata?.optString('label');
}

function readDevice(r: Reader): Device {
  return {
    id: r.string('id'),
    label: labelOf(r),
    principalId: r.optString('principal_id'),
    createdAt: r.string('created_at'),
    lastSeenAt: r.optString('last_seen_at'),
    deviceClass: r.optString('device_class'),
    harness: r.optString('harness'),
    delegationOnly: r.optBoolean('delegation_only') ?? false,
  };
}

/**
 * The operator answers `{"enrollments": [...]}`. Its openapi.yaml says
 * `EnrollmentList {items}`, which no release has sent (found by the
 * end-to-end suite against v0.1.164); `items` is read only if an operator
 * ever matches its own document.
 */
export function readDevices(body: unknown): readonly Device[] {
  const r = R.of('/v1/endpoints/enrollments', body);
  return r.raw('enrollments') === undefined
    ? r.list('items', readDevice)
    : r.list('enrollments', readDevice);
}

export function useDevices(): ReturnType<typeof useQuery<readonly Device[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.devices(op.fqdn.value ?? '')),
    queryFn: async () => readDevices(await op.request('/v1/endpoints/enrollments')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export function useRevokeDevice(): ReturnType<typeof useMutation<unknown, Error, string>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      op.request(`/v1/endpoints/enrollments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.devices(op.fqdn.value ?? '') }),
  });
}
