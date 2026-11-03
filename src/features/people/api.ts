import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { components } from '@/api/generated/operator';
import type { Reader } from '@/api/guards.ts';
import { readArray, Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

type SubUserWire = components['schemas']['SubUserSummary'];

export interface SubUser {
  readonly id: SubUserWire['id'];
  readonly displayName: SubUserWire['display_name'];
  readonly createdAt: SubUserWire['created_at'];
  readonly lastUsedAt: string | undefined;
}

function readSubUser(r: Reader): SubUser {
  return {
    id: r.string('id'),
    displayName: r.string('display_name'),
    createdAt: r.string('created_at'),
    lastUsedAt: r.optString('last_used_at'),
  };
}

export function readSubUsers(body: unknown): readonly SubUser[] {
  return readArray('/v1/admin/sub-users', body, readSubUser);
}

export function useSubUsers(): ReturnType<typeof useQuery<readonly SubUser[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.subUsers(op.fqdn.value ?? '')),
    queryFn: async () => readSubUsers(await op.request('/v1/admin/sub-users?limit=200')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

/**
 * The response carries the sub-user's bearer once. The console reads only
 * the id and name: a person's device joins with a pairing code, never with
 * a token copied out of a browser.
 */
export function readCreatedSubUser(body: unknown): {
  readonly id: string;
  readonly displayName: string;
} {
  const r = R.of('/v1/admin/sub-users', body);
  return { id: r.string('id'), displayName: r.string('display_name') };
}

export type PeopleWrite =
  | { readonly op: 'create'; readonly displayName: string }
  | { readonly op: 'revoke'; readonly id: string }
  | { readonly op: 'block'; readonly id: string }
  | { readonly op: 'unblock'; readonly id: string };

export function usePeopleWrite(): ReturnType<typeof useMutation<unknown, Error, PeopleWrite>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (write: PeopleWrite): Promise<unknown> => {
      switch (write.op) {
        case 'create':
          return readCreatedSubUser(
            await op.request('/v1/admin/sub-users', {
              method: 'POST',
              body: JSON.stringify({ display_name: write.displayName }),
            }),
          );
        case 'revoke':
          return op.request(`/v1/admin/sub-users/${encodeURIComponent(write.id)}`, {
            method: 'DELETE',
          });
        case 'block':
          return op.request(
            `/v1/admin/sub-users/${encodeURIComponent(write.id)}/publication-block`,
            { method: 'PUT' },
          );
        case 'unblock':
          return op.request(
            `/v1/admin/sub-users/${encodeURIComponent(write.id)}/publication-block`,
            { method: 'DELETE' },
          );
      }
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.subUsers(op.fqdn.value ?? '') }),
  });
}
