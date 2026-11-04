import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { components } from '@/api/generated/operator';
import type { Json, Reader } from '@/api/guards.ts';
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

/**
 * How a new person gets an account (SPEC-144 FR-71/72, operator v0.1.166+
 * with the person lane on): `offer` lets them link one from their first
 * device, `none` adds them without one. Sent only after the operator asked
 * (`account_choice_required`); an older operator never sees the fields.
 */
export type AccountChoice = 'offer' | 'none';

export function createBody(displayName: string, account?: AccountChoice): Json {
  return {
    display_name: displayName,
    ...(account === 'offer' ? { account_offer: true } : {}),
    ...(account === 'none' ? { without_account: true } : {}),
  };
}

export type PeopleWrite =
  | { readonly op: 'create'; readonly displayName: string; readonly account?: AccountChoice }
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
              body: JSON.stringify(createBody(write.displayName, write.account)),
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
