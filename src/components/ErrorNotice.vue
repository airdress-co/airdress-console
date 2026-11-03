<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { describeError } from '@/api/describe.ts';

const { error } = defineProps<{ error: unknown }>();
const { t } = useI18n();
const described = computed(() => describeError(error));
</script>

<template>
  <div class="notice notice-error" role="alert">
    <p>{{ t(described.key, described.values) }}</p>
    <p v-if="described.code !== undefined || described.requestId !== undefined" class="quote">
      <span v-if="described.code !== undefined">{{
        t('errors.code', { code: described.code })
      }}</span>
      <span v-if="described.requestId !== undefined">
        {{ t('errors.requestId', { id: described.requestId }) }}
      </span>
    </p>
  </div>
</template>
