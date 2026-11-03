<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { Subname } from './api.ts';
import { RECORD_TYPES, useSubnameWrite, useSubnames } from './api.ts';

/** DNS subnames under the airdress (FR-30). Removing one is destructive; adding one is not. */
const { t } = useI18n();
const zone = useSubnames();
const write = useSubnameWrite();
const stepUp = useStepUp();

const label = ref('');
const type = ref<string>('A');
const rdata = ref('');
const ttl = ref('');
const added = ref<string | undefined>(undefined);

const resumed = stepUp.resume('subnames');
const target = ref<PendingAction | undefined>(resumed);
const confirming = ref(resumed !== undefined);
const wasResumed = ref(resumed !== undefined);
const done = ref<string | undefined>(undefined);

const ttlValue = computed(() => {
  const raw = ttl.value.trim();
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
});
const canAdd = computed(
  () =>
    label.value.trim() !== '' && rdata.value.trim() !== '' && !Number.isNaN(ttlValue.value ?? 0),
);
const fqdnOf = (s: Subname): string => `${s.label}.${zone.data.value?.zone ?? ''}`;

async function add(): Promise<void> {
  if (!canAdd.value) return;
  added.value = undefined;
  const subname = {
    label: label.value.trim(),
    type: type.value,
    rdata: rdata.value.trim(),
    ttl: ttlValue.value,
  };
  try {
    await write.mutateAsync({ op: 'add', subname });
    added.value = `${subname.label}.${zone.data.value?.zone ?? ''}`;
    label.value = '';
    rdata.value = '';
    ttl.value = '';
  } catch {
    // Shown from `write.error`; the form keeps what was typed.
  }
}

function ask(s: Subname): void {
  done.value = undefined;
  wasResumed.value = false;
  target.value = { area: 'subnames', op: 'remove', target: s.id, label: fqdnOf(s) };
  confirming.value = true;
}

async function confirm(): Promise<void> {
  const action = target.value;
  if (action === undefined) return;
  try {
    await stepUp.run(action, () => write.mutateAsync({ op: 'remove', id: action.target }));
    done.value = action.label;
    confirming.value = false;
  } catch {
    // Shown from `write.error`; a step-up has already redirected.
  }
}
</script>

<template>
  <AreaFrame area="subnames">
    <ErrorNotice v-if="zone.error.value !== null" :error="zone.error.value" />
    <p v-else-if="zone.isPending.value">{{ t('common.loading') }}</p>
    <template v-else-if="zone.data.value !== undefined">
      <p>
        {{ t('subnames.zone') }} <span class="mono">{{ zone.data.value.zone }}</span>
      </p>
      <p v-if="!zone.data.value.delegated" class="notice">{{ t('subnames.notDelegated') }}</p>
      <form class="form" @submit.prevent="add">
        <label for="subname-label">{{ t('subnames.label') }}</label>
        <input
          id="subname-label"
          v-model="label"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <label for="subname-type">{{ t('subnames.type') }}</label>
        <select id="subname-type" v-model="type">
          <option v-for="rt in RECORD_TYPES" :key="rt" :value="rt">{{ rt }}</option>
        </select>
        <label for="subname-rdata">{{ t('subnames.rdata') }}</label>
        <input
          id="subname-rdata"
          v-model="rdata"
          type="text"
          autocomplete="off"
          spellcheck="false"
        />
        <label for="subname-ttl">{{ t('subnames.ttl') }}</label>
        <input
          id="subname-ttl"
          v-model="ttl"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          aria-describedby="subname-ttl-hint"
        />
        <p id="subname-ttl-hint" class="hint">{{ t('subnames.ttlHint') }}</p>
        <div class="actions">
          <button type="submit" class="primary" :disabled="!canAdd || write.isPending.value">
            {{ t('subnames.add') }}
          </button>
        </div>
      </form>
      <p v-if="added !== undefined" class="notice notice-ok" role="status">
        {{ t('subnames.added', { name: added }) }}
      </p>
      <p v-if="done !== undefined" class="notice notice-ok" role="status">
        {{ t('subnames.removed', { name: done }) }}
      </p>
      <ErrorNotice v-if="write.error.value !== null" :error="write.error.value" />
      <p v-if="zone.data.value.subnames.length === 0">{{ t('subnames.none') }}</p>
      <table v-else>
        <thead>
          <tr>
            <th scope="col">{{ t('subnames.name') }}</th>
            <th scope="col">{{ t('subnames.type') }}</th>
            <th scope="col">{{ t('subnames.rdata') }}</th>
            <th scope="col">{{ t('subnames.ttl') }}</th>
            <th scope="col">
              <span class="visually-hidden">{{ t('common.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in zone.data.value.subnames" :key="s.id">
            <td class="mono">{{ fqdnOf(s) }}</td>
            <td>{{ s.type }}</td>
            <td class="mono">{{ s.rdata }}</td>
            <td>{{ s.ttl }}</td>
            <td>
              <button type="button" class="danger" @click="ask(s)">
                {{ t('subnames.remove') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <ConfirmDialog
      v-model:open="confirming"
      :title="t('subnames.confirmTitle', { name: target?.label ?? '' })"
      :confirm-label="t('subnames.remove')"
      :busy="write.isPending.value"
      @confirm="confirm"
    >
      <p v-if="wasResumed">{{ t('stepUp.resumed') }}</p>
      <p>{{ t('subnames.confirmBody') }}</p>
    </ConfirmDialog>
  </AreaFrame>
</template>
