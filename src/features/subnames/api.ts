import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

export interface Subname {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly rdata: string;
  readonly ttl: number;
  readonly createdAt: string;
}

export interface SubnameZone {
  readonly zone: string;
  readonly delegated: boolean;
  readonly subnames: readonly Subname[];
}

function readSubname(r: Reader): Subname {
  return {
    id: r.string('id'),
    label: r.string('label'),
    type: r.string('type'),
    rdata: r.string('rdata'),
    ttl: r.number('ttl'),
    createdAt: r.string('created_at'),
  };
}

export function readSubnameZone(body: unknown): SubnameZone {
  const r = R.of('/v1/admin/dns/subnames', body);
  return {
    zone: r.string('zone'),
    delegated: r.boolean('delegated'),
    subnames: r.list('subnames', readSubname),
  };
}

export function useSubnames(): ReturnType<typeof useQuery<SubnameZone>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.subnames(op.fqdn.value ?? '')),
    queryFn: async () => readSubnameZone(await op.request('/v1/admin/dns/subnames')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'] as const;

export interface NewSubname {
  readonly label: string;
  readonly type: string;
  readonly rdata: string;
  readonly ttl: number | undefined;
}

export type SubnameWrite =
  | { readonly op: 'add'; readonly subname: NewSubname }
  | { readonly op: 'remove'; readonly id: string };

export function useSubnameWrite(): ReturnType<typeof useMutation<unknown, Error, SubnameWrite>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: SubnameWrite): Promise<unknown> => {
      switch (write.op) {
        case 'add': {
          const { label, type, rdata, ttl } = write.subname;
          return op.request('/v1/admin/dns/subnames', {
            method: 'POST',
            body: JSON.stringify(
              ttl === undefined ? { label, type, rdata } : { label, type, rdata, ttl },
            ),
          });
        }
        case 'remove':
          return op.request(`/v1/admin/dns/subnames/${encodeURIComponent(write.id)}`, {
            method: 'DELETE',
          });
      }
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.subnames(op.fqdn.value ?? '') }),
  });
}
