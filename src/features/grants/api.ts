import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

/** The actions a grant can name (operator `authz::Action`, v0.1.164). */
export const GRANT_ACTIONS = [
  'Get',
  'Apply',
  'Delete',
  'ReadStatus',
  'ReadSource',
  'Publish',
  'Promote',
  'Operate',
  'Observe',
  'Command',
  'Open',
  'Attach',
  'Input',
  'AgentBusRead',
  'AgentBusPost',
  'AgentBusClaim',
  'AgentBusStateWrite',
  'ReadWork',
  'WriteWork',
] as const;

export interface Grant {
  readonly id: string;
  readonly principalId: string;
  readonly kind: string;
  readonly resource: string | undefined;
  readonly actions: readonly string[];
  readonly createdAt: string;
  readonly createdBy: string;
}

function readGrant(r: Reader): Grant {
  return {
    id: r.string('id'),
    principalId: r.string('principal_id'),
    kind: r.string('kind'),
    resource: r.optString('resource'),
    actions: r.strings('actions'),
    createdAt: r.string('created_at'),
    createdBy: r.string('created_by'),
  };
}

export const readGrants = (body: unknown): readonly Grant[] =>
  R.of('/v1/admin/grants', body).list('grants', readGrant);

export function useGrants(): ReturnType<typeof useQuery<readonly Grant[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.grants(op.fqdn.value ?? '')),
    queryFn: async () => readGrants(await op.request('/v1/admin/grants')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export interface NewGrant {
  readonly principalId: string;
  readonly kind: string;
  /** Undefined grants every resource of the kind. */
  readonly resource: string | undefined;
  readonly actions: readonly string[];
}

export type GrantWrite =
  | { readonly op: 'create'; readonly grant: NewGrant }
  | { readonly op: 'revoke'; readonly id: string };

export function useGrantWrite(): ReturnType<typeof useMutation<unknown, Error, GrantWrite>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: GrantWrite): Promise<unknown> => {
      switch (write.op) {
        case 'create': {
          const g = write.grant;
          const body =
            g.resource === undefined
              ? { principal_id: g.principalId, kind: g.kind, actions: g.actions }
              : {
                  principal_id: g.principalId,
                  kind: g.kind,
                  resource: g.resource,
                  actions: g.actions,
                };
          return op.request('/v1/admin/grants', { method: 'POST', body: JSON.stringify(body) });
        }
        case 'revoke':
          return op.request(`/v1/admin/grants/${encodeURIComponent(write.id)}`, {
            method: 'DELETE',
          });
      }
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.grants(op.fqdn.value ?? '') }),
  });
}
