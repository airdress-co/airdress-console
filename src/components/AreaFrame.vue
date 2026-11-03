<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Area } from '@/compat.ts';
import { requiredFor } from '@/compat.ts';
import { useAreaSupport } from '@/operator/use-operator.ts';

/**
 * An area's page: its heading, and nothing else when this operator is too
 * old to serve it (FR-23). An unknown version renders the area; its own
 * calls then say what the operator answered.
 */
const { area } = defineProps<{ area: Area }>();
defineSlots<{ default(): unknown }>();

const { t } = useI18n();
const supported = useAreaSupport(() => area);
const required = computed(() => requiredFor(area));
</script>

<template>
  <section class="area" :aria-labelledby="`${area}-heading`">
    <h1 :id="`${area}-heading`">{{ t(`nav.${area}`) }}</h1>
    <p v-if="supported === false" class="notice">
      {{ t('compat.unavailable', { version: required }) }}
    </p>
    <slot v-else />
  </section>
</template>
