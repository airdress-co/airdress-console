<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { HttpError } from '@/api/errors.ts';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { formatTime, shortId } from '@/format.ts';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { Machine, PendingMachine, PreauthKey } from './api.ts';
import {
  proofOf,
  useMachineWrite,
  useMachines,
  usePendingMachines,
  usePreauthKeys,
} from './api.ts';

/**
 * Machines (FR-29, design §8). Approving asks for what the machine printed,
 * typed by the person; the console never shows or pre-fills it. Approve,
 * deny and both revokes are destructive (step-up).
 */
type MachineOp = 'approve' | 'deny' | 'revoke' | 'revoke-key';

const { t, locale } = useI18n();
const pending = usePendingMachines();
const machines = useMachines();
const keys = usePreauthKeys();
const write = useMachineWrite();
const stepUp = useStepUp();

const resumed = stepUp.resume('machines');
const target = ref<PendingAction | undefined>(resumed);
const confirming = ref(resumed !== undefined);
const wasResumed = ref(resumed !== undefined);
const done = ref<string | undefined>(undefined);

const proof = ref('');
const reason = ref('');
const sourceSigning = ref<'rotated' | 'compromised' | ''>('');
const needsSourceSigning = computed(
  () =>
    write.error.value instanceof HttpError &&
    write.error.value.code === 'source_signing_kind_required',
);

const targetOp = computed<MachineOp>(() => {
  const op = target.value?.op;
  return op === 'approve' || op === 'deny' || op === 'revoke-key' ? op : 'revoke';
});
const canConfirm = computed(() => {
  if (targetOp.value === 'approve') return proof.value.trim() !== '';
  if (targetOp.value === 'revoke') {
    return reason.value.trim() !== '' && (!needsSourceSigning.value || sourceSigning.value !== '');
  }
  return true;
});

function open(op: MachineOp, id: string, label: string): void {
  done.value = undefined;
  wasResumed.value = false;
  proof.value = '';
  reason.value = '';
  sourceSigning.value = '';
  write.reset();
  target.value = { area: 'machines', op, target: id, label };
  confirming.value = true;
}

const askPending = (m: PendingMachine, op: 'approve' | 'deny'): void => {
  open(op, m.userCode, m.name ?? m.userCode);
};
const askMachine = (m: Machine): void => {
  open('revoke', m.id, m.name ?? shortId(m.id));
};
const askKey = (k: PreauthKey): void => {
  open('revoke-key', k.id, k.description ?? shortId(k.id));
};

async function confirm(): Promise<void> {
  const action = target.value;
  if (action === undefined || !canConfirm.value) return;
  const op = targetOp.value;
  try {
    await stepUp.run(action, () => {
      switch (op) {
        case 'approve':
          return write.mutateAsync({ op, userCode: action.target, proof: proofOf(proof.value) });
        case 'deny':
          return write.mutateAsync({ op, userCode: action.target });
        case 'revoke':
          return write.mutateAsync({
            op,
            id: action.target,
            reason: reason.value.trim(),
            sourceSigning: sourceSigning.value === '' ? undefined : sourceSigning.value,
          });
        case 'revoke-key':
          return write.mutateAsync({ op, id: action.target });
      }
    });
    done.value = t(`machines.done.${op}`, { name: action.label });
    confirming.value = false;
    proof.value = '';
  } catch {
    // Shown from `write.error`; a step-up has already redirected.
  }
}
</script>

<template>
  <AreaFrame area="machines">
    <p v-if="done !== undefined" class="notice notice-ok" role="status">{{ done }}</p>

    <h2>{{ t('machines.waiting') }}</h2>
    <ErrorNotice v-if="pending.error.value !== null" :error="pending.error.value" />
    <p v-else-if="pending.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="(pending.data.value ?? []).length === 0">{{ t('machines.noneWaiting') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('machines.machine') }}</th>
          <th scope="col">{{ t('machines.userCode') }}</th>
          <th scope="col">{{ t('machines.purpose') }}</th>
          <th scope="col">{{ t('machines.expires') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in pending.data.value ?? []" :key="m.userCode">
          <td>
            {{ m.name ?? '—' }}
            <div class="hint">
              {{ t(`machines.kind.${m.kind === 'reauth' ? 'reauth' : 'new'}`) }}
            </div>
          </td>
          <td class="mono">{{ m.userCode }}</td>
          <td>{{ m.purpose ?? '—' }}</td>
          <td>{{ formatTime(m.expiresAt, locale) }}</td>
          <td class="row-actions">
            <button type="button" class="primary" @click="askPending(m, 'approve')">
              {{ t('machines.approve') }}
            </button>
            <button type="button" class="danger" @click="askPending(m, 'deny')">
              {{ t('machines.deny') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>{{ t('machines.approved') }}</h2>
    <ErrorNotice v-if="machines.error.value !== null" :error="machines.error.value" />
    <p v-else-if="machines.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="(machines.data.value ?? []).length === 0">{{ t('machines.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('machines.machine') }}</th>
          <th scope="col">{{ t('machines.approvedAt') }}</th>
          <th scope="col">{{ t('machines.authorizationUntil') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in machines.data.value ?? []" :key="m.id">
          <td>
            {{ m.name ?? '—' }}
            <div class="hint mono">{{ shortId(m.id) }}</div>
          </td>
          <td>{{ formatTime(m.approvedAt, locale) }}</td>
          <td>
            {{
              m.authorizationExpiresAt === undefined
                ? t('machines.noExpiry')
                : formatTime(m.authorizationExpiresAt, locale)
            }}
          </td>
          <td>
            <span v-if="m.revokedAt !== undefined" class="status-off">{{
              t('machines.revokedState')
            }}</span>
            <button v-else type="button" class="danger" @click="askMachine(m)">
              {{ t('machines.revoke') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>{{ t('machines.keys') }}</h2>
    <ErrorNotice v-if="keys.error.value !== null" :error="keys.error.value" />
    <p v-else-if="keys.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="(keys.data.value ?? []).length === 0">{{ t('machines.noKeys') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('machines.key') }}</th>
          <th scope="col">{{ t('machines.keyState') }}</th>
          <th scope="col">{{ t('machines.keyUses') }}</th>
          <th scope="col">{{ t('machines.expires') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="k in keys.data.value ?? []" :key="k.id">
          <td>
            {{ k.description ?? '—' }}
            <div class="hint mono">{{ shortId(k.id) }}</div>
          </td>
          <td>{{ k.state }}</td>
          <td>
            {{ k.maxUses === undefined ? k.uses : `${String(k.uses)} / ${String(k.maxUses)}` }}
          </td>
          <td>{{ formatTime(k.expiresAt, locale) }}</td>
          <td>
            <button v-if="k.state === 'active'" type="button" class="danger" @click="askKey(k)">
              {{ t('machines.revoke') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <ConfirmDialog
      v-model:open="confirming"
      :title="t(`machines.confirm.${targetOp}`, { name: target?.label ?? '' })"
      :confirm-label="t(`machines.action.${targetOp}`)"
      :busy="write.isPending.value"
      :confirm-disabled="!canConfirm"
      @confirm="confirm"
    >
      <p v-if="wasResumed">{{ t('stepUp.resumed') }}</p>
      <template v-if="targetOp === 'approve'">
        <p class="notice">{{ t('machines.approveWarning') }}</p>
        <label for="machine-proof">{{ t('machines.proofLabel') }}</label>
        <input
          id="machine-proof"
          v-model="proof"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-describedby="machine-proof-hint"
        />
        <p id="machine-proof-hint" class="hint">{{ t('machines.proofHint') }}</p>
      </template>
      <template v-else-if="targetOp === 'revoke'">
        <label for="machine-reason">{{ t('machines.reasonLabel') }}</label>
        <input id="machine-reason" v-model="reason" type="text" autocomplete="off" />
        <template v-if="needsSourceSigning">
          <p class="notice">{{ t('machines.sourceSigningHint') }}</p>
          <label for="machine-source-signing">{{ t('machines.sourceSigningLabel') }}</label>
          <select id="machine-source-signing" v-model="sourceSigning">
            <option value="" disabled>{{ t('common.choose') }}</option>
            <option value="rotated">{{ t('machines.rotated') }}</option>
            <option value="compromised">{{ t('machines.compromised') }}</option>
          </select>
        </template>
      </template>
      <p v-else>{{ t(`machines.confirmBody.${targetOp}`) }}</p>
      <ErrorNotice v-if="write.error.value !== null" :error="write.error.value" />
    </ConfirmDialog>
  </AreaFrame>
</template>
