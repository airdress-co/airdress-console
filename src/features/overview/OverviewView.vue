<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AreaFrame from '@/components/AreaFrame.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { useClientConfig, useOperator } from '@/operator/use-operator.ts';
import { useCapabilities, useReadiness } from './api.ts';

const { t } = useI18n();
const op = useOperator();
const config = useClientConfig();
const capabilities = useCapabilities();
const ready = useReadiness();

const switches = computed(() => {
  const c = capabilities.data.value;
  if (c === undefined) return [];
  return [
    { key: 'agentBus', on: c.agentBus },
    { key: 'agentDevices', on: c.agentDevices },
    { key: 'mcpLocal', on: c.mcpLocal },
    { key: 'mcpRemote', on: c.mcpRemote },
  ] as const;
});
</script>

<template>
  <AreaFrame area="overview">
    <dl class="facts">
      <dt>{{ t('overview.address') }}</dt>
      <dd class="mono">{{ op.fqdn.value }}</dd>
      <dt>{{ t('overview.name') }}</dt>
      <dd>{{ config.data.value?.operatorName ?? '—' }}</dd>
      <dt>{{ t('overview.version') }}</dt>
      <dd class="mono">{{ config.data.value?.operatorVersion ?? '—' }}</dd>
      <dt>{{ t('overview.reachability') }}</dt>
      <dd :class="ready.data.value === true ? 'status-on' : 'status-off'">
        {{
          ready.isPending.value
            ? t('common.loading')
            : ready.data.value === true
              ? t('overview.ready')
              : t('overview.notReady')
        }}
      </dd>
    </dl>
    <h2>{{ t('overview.switches') }}</h2>
    <p class="hint">{{ t('overview.switchesHint') }}</p>
    <ErrorNotice v-if="capabilities.error.value !== null" :error="capabilities.error.value" />
    <ul v-else class="switches">
      <li v-for="s in switches" :key="s.key">
        {{ t(`overview.switch.${s.key}`) }}:
        <span :class="s.on ? 'status-on' : 'status-off'">{{
          s.on ? t('common.on') : t('common.off')
        }}</span>
      </li>
    </ul>
  </AreaFrame>
</template>
