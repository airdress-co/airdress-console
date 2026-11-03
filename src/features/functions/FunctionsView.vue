<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AreaFrame from '@/components/AreaFrame.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import type { Resource } from './api.ts';
import { isEnabled, isKindUnknown, useFunctions } from './api.ts';

/** Functions (FR-33): status at a glance; versions, logs and switching on the detail page. */
const { t } = useI18n();
const functions = useFunctions();
const rows = computed(() => functions.data.value ?? []);

function ready(fn: Resource): {
  readonly state: 'ready' | 'notReady';
  readonly reason: string | undefined;
} {
  const c = fn.conditions.find((x) => x.type === 'Ready');
  const loaded = fn.conditions.find((x) => x.type === 'Loaded');
  if (c?.status === 'True') return { state: 'ready', reason: undefined };
  return {
    state: 'notReady',
    reason: (loaded?.status === 'False' ? loaded.reason : c?.reason) ?? undefined,
  };
}
</script>

<template>
  <AreaFrame area="functions">
    <p class="hint">{{ t('functions.lead') }}</p>
    <p v-if="isKindUnknown(functions.error.value)" class="notice">{{ t('functions.notServed') }}</p>
    <ErrorNotice v-else-if="functions.error.value !== null" :error="functions.error.value" />
    <p v-else-if="functions.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="rows.length === 0">{{ t('functions.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('functions.name') }}</th>
          <th scope="col">{{ t('functions.state') }}</th>
          <th scope="col">{{ t('functions.switch') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fn in rows" :key="fn.name">
          <td>
            <RouterLink :to="{ name: 'function', params: { name: fn.name } }" class="mono">{{
              fn.name
            }}</RouterLink>
          </td>
          <td>
            <span :class="ready(fn).state === 'ready' ? 'status-on' : 'status-off'">
              {{ t(`functions.${ready(fn).state}`) }}
            </span>
            <span v-if="ready(fn).reason !== undefined" class="hint">
              · {{ ready(fn).reason }}</span
            >
          </td>
          <td>{{ isEnabled(fn) ? t('common.on') : t('common.off') }}</td>
        </tr>
      </tbody>
    </table>
  </AreaFrame>
</template>
