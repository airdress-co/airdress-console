<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { HttpError } from '@/api/errors.ts';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { ShellHost } from './api.ts';
import { useRevokeShellHost, useShellHosts } from './api.ts';

/** Shell hosts (FR-31). Off on most operators: shown as off, not as an error. */
const { t } = useI18n();
const hosts = useShellHosts();
const revoke = useRevokeShellHost();
const stepUp = useStepUp();

const switchedOff = computed(
  () => hosts.error.value instanceof HttpError && hosts.error.value.code === 'not_enabled',
);

const resumed = stepUp.resume('shells');
const target = ref<PendingAction | undefined>(resumed);
const confirming = ref(resumed !== undefined);
const wasResumed = ref(resumed !== undefined);
const done = ref<string | undefined>(undefined);

function ask(h: ShellHost): void {
  done.value = undefined;
  wasResumed.value = false;
  target.value = { area: 'shells', op: 'revoke', target: h.name, label: h.name };
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
    // Shown from `revoke.error`; a step-up has already redirected.
  }
}
</script>

<template>
  <AreaFrame area="shells">
    <p v-if="switchedOff" class="notice">{{ t('shells.off') }}</p>
    <ErrorNotice v-else-if="hosts.error.value !== null" :error="hosts.error.value" />
    <p v-else-if="hosts.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="(hosts.data.value ?? []).length === 0">{{ t('shells.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('shells.host') }}</th>
          <th scope="col">{{ t('shells.state') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in hosts.data.value ?? []" :key="h.name">
          <td class="mono">{{ h.name }}</td>
          <td>
            <span :class="h.connected ? 'status-on' : 'status-off'">
              {{
                h.connected
                  ? t('shells.connected')
                  : h.linked
                    ? t('shells.linked')
                    : t('shells.unlinked')
              }}
            </span>
            <span v-if="!h.enabled" class="status-off"> · {{ t('shells.disabled') }}</span>
          </td>
          <td>
            <button type="button" class="danger" @click="ask(h)">{{ t('shells.revoke') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="done !== undefined" class="notice notice-ok" role="status">
      {{ t('shells.revoked', { name: done }) }}
    </p>
    <ErrorNotice v-if="revoke.error.value !== null" :error="revoke.error.value" />
    <ConfirmDialog
      v-model:open="confirming"
      :resumed="wasResumed ? 'confirm' : 'none'"
      :title="t('shells.confirmTitle', { name: target?.label ?? '' })"
      :confirm-label="t('shells.revoke')"
      :busy="revoke.isPending.value"
      @confirm="confirm"
    >
      <p>{{ t('shells.confirmBody') }}</p>
    </ConfirmDialog>
  </AreaFrame>
</template>
