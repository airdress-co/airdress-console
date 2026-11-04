<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { useMachines } from '@/features/machines/api.ts';
import { useSubUsers } from '@/features/people/api.ts';
import { formatTime, shortId } from '@/format.ts';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { Grant } from './api.ts';
import { GRANT_ACTIONS, useGrantWrite, useGrants } from './api.ts';

/**
 * Resource grants (FR-32): who may do what on this operator, for sub-users
 * and machines. Creating and revoking are both destructive (D-14). No token
 * is minted here: a grant acts on this operator, a token would leave it (D-7).
 */
const KINDS = ['Function', 'Schedule', 'Home', 'ShellHost', 'EventSubscription', 'Work', '*'];

const { t, locale } = useI18n();
const grants = useGrants();
const people = useSubUsers();
const machines = useMachines();
const write = useGrantWrite();
const stepUp = useStepUp();

const principalId = ref('');
const kind = ref('Function');
const resource = ref('');
const actions = ref<string[]>([]);

const resumed = stepUp.resume('grants');
const target = ref<PendingAction | undefined>(resumed);
const confirming = ref(resumed !== undefined);
const wasResumed = ref(resumed !== undefined);
const done = ref<string | undefined>(undefined);

interface Principal {
  readonly id: string;
  readonly label: string;
}

const principals = computed<readonly Principal[]>(() => [
  ...(people.data.value ?? []).map((p) => ({
    id: p.id,
    label: t('grants.person', { name: p.displayName }),
  })),
  ...(machines.data.value ?? [])
    .filter((m) => m.revokedAt === undefined)
    .map((m) => ({ id: m.id, label: t('grants.machine', { name: m.name ?? shortId(m.id) }) })),
]);
const nameOf = (id: string): string =>
  principals.value.find((p) => p.id === id)?.label ?? shortId(id);

const canCreate = computed(
  () => principalId.value !== '' && kind.value.trim() !== '' && actions.value.length > 0,
);
const summary = computed(
  () =>
    `${nameOf(principalId.value)}: ${actions.value.join(', ')} ${kind.value}${resource.value.trim() === '' ? '' : `::${resource.value.trim()}`}`,
);

function askCreate(): void {
  if (!canCreate.value) return;
  done.value = undefined;
  wasResumed.value = false;
  target.value = { area: 'grants', op: 'create', target: '', label: summary.value };
  confirming.value = true;
}

function askRevoke(g: Grant): void {
  done.value = undefined;
  wasResumed.value = false;
  target.value = {
    area: 'grants',
    op: 'revoke',
    target: g.id,
    label: `${nameOf(g.principalId)}: ${g.actions.join(', ')} ${g.kind}${g.resource === undefined ? '' : `::${g.resource}`}`,
  };
  confirming.value = true;
}

const targetOp = computed(() => (target.value?.op === 'create' ? 'create' : 'revoke'));
// A resumed create has lost its form (nothing typed crosses the redirect):
// the person fills it in again rather than confirming an empty grant.
const confirmDisabled = computed(() => targetOp.value === 'create' && !canCreate.value);

async function confirm(): Promise<void> {
  const action = target.value;
  if (action === undefined || confirmDisabled.value) return;
  try {
    if (action.op === 'create') {
      const r = resource.value.trim();
      await stepUp.run({ ...action, label: summary.value }, () =>
        write.mutateAsync({
          op: 'create',
          grant: {
            principalId: principalId.value,
            kind: kind.value.trim(),
            resource: r === '' ? undefined : r,
            actions: actions.value,
          },
        }),
      );
      actions.value = [];
      resource.value = '';
    } else {
      await stepUp.run(action, () => write.mutateAsync({ op: 'revoke', id: action.target }));
    }
    done.value = t(`grants.done.${targetOp.value}`, { grant: action.label });
    confirming.value = false;
  } catch {
    // Shown from `write.error`; a step-up has already redirected.
  }
}
</script>

<template>
  <AreaFrame area="grants">
    <p class="hint">{{ t('grants.lead') }}</p>
    <form class="form" @submit.prevent="askCreate">
      <label for="grant-principal">{{ t('grants.principal') }}</label>
      <select id="grant-principal" v-model="principalId">
        <option value="" disabled>{{ t('common.choose') }}</option>
        <option v-for="p in principals" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
      <label for="grant-kind">{{ t('grants.kind') }}</label>
      <input id="grant-kind" v-model="kind" type="text" list="grant-kinds" autocomplete="off" />
      <datalist id="grant-kinds">
        <option v-for="k in KINDS" :key="k" :value="k" />
      </datalist>
      <label for="grant-resource">{{ t('grants.resource') }}</label>
      <input
        id="grant-resource"
        v-model="resource"
        type="text"
        autocomplete="off"
        aria-describedby="grant-resource-hint"
      />
      <p id="grant-resource-hint" class="hint">{{ t('grants.resourceHint') }}</p>
      <fieldset class="checks">
        <legend>{{ t('grants.actions') }}</legend>
        <label v-for="a in GRANT_ACTIONS" :key="a">
          <input v-model="actions" type="checkbox" :value="a" />
          {{ a }}
        </label>
      </fieldset>
      <div class="actions">
        <button type="submit" class="primary" :disabled="!canCreate || write.isPending.value">
          {{ t('grants.create') }}
        </button>
      </div>
    </form>
    <p v-if="done !== undefined" class="notice notice-ok" role="status">{{ done }}</p>
    <ErrorNotice v-if="write.error.value !== null" :error="write.error.value" />
    <ErrorNotice v-if="grants.error.value !== null" :error="grants.error.value" />
    <p v-else-if="grants.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="(grants.data.value ?? []).length === 0">{{ t('grants.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('grants.principal') }}</th>
          <th scope="col">{{ t('grants.kind') }}</th>
          <th scope="col">{{ t('grants.resource') }}</th>
          <th scope="col">{{ t('grants.actions') }}</th>
          <th scope="col">{{ t('grants.createdBy') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in grants.data.value ?? []" :key="g.id">
          <td>{{ nameOf(g.principalId) }}</td>
          <td>{{ g.kind }}</td>
          <td class="mono">{{ g.resource ?? t('grants.everyResource') }}</td>
          <td>{{ g.actions.join(', ') }}</td>
          <td>
            <span class="mono">{{ g.createdBy }}</span>
            <div class="hint">{{ formatTime(g.createdAt, locale) }}</div>
          </td>
          <td>
            <button type="button" class="danger" @click="askRevoke(g)">
              {{ t('grants.revoke') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <ConfirmDialog
      v-model:open="confirming"
      :resumed="wasResumed ? (targetOp === 'create' ? 'form' : 'confirm') : 'none'"
      :title="t(`grants.confirm.${targetOp}`)"
      :confirm-label="t(`grants.${targetOp}`)"
      :busy="write.isPending.value"
      :confirm-disabled="confirmDisabled"
      @confirm="confirm"
    >
      <p class="mono">{{ targetOp === 'create' ? summary : target?.label }}</p>
    </ConfirmDialog>
  </AreaFrame>
</template>
