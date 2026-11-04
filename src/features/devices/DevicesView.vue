<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { formatTime, shortId } from '@/format.ts';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { Device } from './api.ts';
import { useDevices, useRevokeDevice } from './api.ts';

const { t, locale } = useI18n();
const devices = useDevices();
const revoke = useRevokeDevice();
const stepUp = useStepUp();

const resumed = stepUp.resume('devices');
const target = ref<PendingAction | undefined>(resumed);
const confirming = ref(resumed !== undefined);
const wasResumed = ref(resumed !== undefined);
const done = ref<string | undefined>(undefined);

function nameOf(device: Device): string {
  return device.label ?? device.harness ?? shortId(device.id);
}

const rows = computed(() => devices.data.value ?? []);

function ask(device: Device): void {
  done.value = undefined;
  wasResumed.value = false;
  target.value = { area: 'devices', op: 'revoke', target: device.id, label: nameOf(device) };
  confirming.value = true;
}

async function confirm(): Promise<void> {
  const action = target.value;
  if (action === undefined) return;
  try {
    await stepUp.run(action, () => revoke.mutateAsync(action.target));
    done.value = action.label;
    confirming.value = false;
  } catch {
    // The error is on `revoke.error`; a step-up has already redirected.
  }
}
</script>

<template>
  <AreaFrame area="devices">
    <p class="hint">{{ t('devices.lead') }}</p>
    <p v-if="done !== undefined" class="notice notice-ok" role="status">
      {{ t('devices.revoked', { name: done }) }}
    </p>
    <ErrorNotice v-if="revoke.error.value !== null" :error="revoke.error.value" />
    <ErrorNotice v-if="devices.error.value !== null" :error="devices.error.value" />
    <p v-else-if="devices.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="rows.length === 0">{{ t('devices.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('devices.device') }}</th>
          <th scope="col">{{ t('devices.kind') }}</th>
          <th scope="col">{{ t('devices.lastSeen') }}</th>
          <th scope="col">{{ t('devices.enrolled') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in rows" :key="d.id">
          <td>
            {{ nameOf(d) }}
            <div class="hint mono">{{ shortId(d.id) }}</div>
          </td>
          <td>{{ d.delegationOnly ? t('devices.cli') : (d.deviceClass ?? '—') }}</td>
          <td>{{ formatTime(d.lastSeenAt, locale) }}</td>
          <td>{{ formatTime(d.createdAt, locale) }}</td>
          <td>
            <button type="button" class="danger" @click="ask(d)">
              {{ t('devices.revoke') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <ConfirmDialog
      v-model:open="confirming"
      :resumed="wasResumed ? 'confirm' : 'none'"
      :title="t('devices.confirmTitle', { name: target?.label ?? '' })"
      :confirm-label="t('devices.revoke')"
      :busy="revoke.isPending.value"
      @confirm="confirm"
    >
      <p>{{ t('devices.confirmBody') }}</p>
    </ConfirmDialog>
  </AreaFrame>
</template>
