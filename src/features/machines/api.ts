import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

/**
 * A machine waiting for approval. The operator's list also carries the
 * fingerprint and confirmation code the machine printed; the console never
 * reads them, so it cannot show or pre-fill them. The person types what the
 * machine shows (design §8): pre-filling would turn the comparison into a
 * click.
 */
export interface PendingMachine {
  readonly userCode: string;
  readonly name: string | undefined;
  readonly kind: string;
  readonly purpose: string | undefined;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface Machine {
  readonly id: string;
  readonly name: string | undefined;
  readonly approvedAt: string | undefined;
  readonly approvedBy: string | undefined;
  readonly revokedAt: string | undefined;
  readonly authorizationExpiresAt: string | undefined;
}

export interface PreauthKey {
  readonly id: string;
  readonly description: string | undefined;
  readonly state: string;
  readonly uses: number;
  readonly maxUses: number | undefined;
  readonly expiresAt: string;
}

function readPending(r: Reader): PendingMachine {
  return {
    userCode: r.string('user_code'),
    name: r.optString('name'),
    kind: r.string('kind'),
    purpose: r.optString('purpose'),
    createdAt: r.string('created_at'),
    expiresAt: r.string('expires_at'),
  };
}

function readMachine(r: Reader): Machine {
  return {
    id: r.string('machine_id'),
    name: r.optString('name'),
    approvedAt: r.optString('approved_at'),
    approvedBy: r.optString('approved_by'),
    revokedAt: r.optString('revoked_at'),
    authorizationExpiresAt: r.optRecord('authorization')?.optString('expires_at'),
  };
}

function readKey(r: Reader): PreauthKey {
  return {
    id: r.string('id'),
    description: r.optString('description'),
    state: r.string('state'),
    uses: r.number('uses'),
    maxUses: r.optNumber('max_uses'),
    expiresAt: r.string('expires_at'),
  };
}

export const readPendingMachines = (body: unknown): readonly PendingMachine[] =>
  R.of('/v1/admin/machines/enrollments', body).list('enrollments', readPending);
export const readMachines = (body: unknown): readonly Machine[] =>
  R.of('/v1/admin/machines', body).list('machines', readMachine);
export const readPreauthKeys = (body: unknown): readonly PreauthKey[] =>
  R.of('/v1/admin/machines/preauth-keys', body).list('keys', readKey);

export function usePendingMachines(): ReturnType<typeof useQuery<readonly PendingMachine[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.machinePending(op.fqdn.value ?? '')),
    queryFn: async () => readPendingMachines(await op.request('/v1/admin/machines/enrollments')),
    enabled: computed(() => op.fqdn.value !== undefined),
    // A machine waiting for approval expires in minutes: keep the list fresh.
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useMachines(): ReturnType<typeof useQuery<readonly Machine[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.machines(op.fqdn.value ?? '')),
    queryFn: async () => readMachines(await op.request('/v1/admin/machines')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export function usePreauthKeys(): ReturnType<typeof useQuery<readonly PreauthKey[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.preauthKeys(op.fqdn.value ?? '')),
    queryFn: async () => readPreauthKeys(await op.request('/v1/admin/machines/preauth-keys')),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

/** What the person typed: the fingerprint or the confirmation code the machine printed. */
export type Proof =
  | { readonly kind: 'fingerprint'; readonly value: string }
  | { readonly kind: 'confirmation_code'; readonly value: string };

export function proofOf(typed: string): Proof {
  const value = typed.trim();
  return value.toUpperCase().startsWith('SHA256:')
    ? { kind: 'fingerprint', value }
    : { kind: 'confirmation_code', value };
}

export type MachineWrite =
  | { readonly op: 'approve'; readonly userCode: string; readonly proof: Proof }
  | { readonly op: 'deny'; readonly userCode: string }
  | {
      readonly op: 'revoke';
      readonly id: string;
      readonly reason: string;
      readonly sourceSigning: 'rotated' | 'compromised' | undefined;
    }
  | { readonly op: 'revoke-key'; readonly id: string };

export function useMachineWrite(): ReturnType<typeof useMutation<unknown, Error, MachineWrite>> {
  const op = useOperator();
  const client = useQueryClient();
  const enc = encodeURIComponent;
  return useMutation({
    mutationFn: (write: MachineWrite): Promise<unknown> => {
      switch (write.op) {
        case 'approve':
          return op.request(`/v1/admin/machines/enrollments/${enc(write.userCode)}/approve`, {
            method: 'POST',
            body: JSON.stringify({ [write.proof.kind]: write.proof.value }),
          });
        case 'deny':
          return op.request(`/v1/admin/machines/enrollments/${enc(write.userCode)}/deny`, {
            method: 'POST',
          });
        case 'revoke':
          return op.request(`/v1/admin/machines/${enc(write.id)}/revoke`, {
            method: 'POST',
            body: JSON.stringify(
              write.sourceSigning === undefined
                ? { reason: write.reason }
                : { reason: write.reason, source_signing: write.sourceSigning },
            ),
          });
        case 'revoke-key':
          return op.request(`/v1/admin/machines/preauth-keys/${enc(write.id)}/revoke`, {
            method: 'POST',
          });
      }
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.area(op.fqdn.value ?? '', 'machines') }),
  });
}
