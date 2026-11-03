<script setup lang="ts">
import { useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Every destructive action asks first, naming the thing (FR-37). A native
 * <dialog>: focus is trapped and Escape cancels without code of our own.
 */
const { title, confirmLabel, busy, confirmDisabled } = defineProps<{
  title: string;
  confirmLabel: string;
  /** A write is in flight: both buttons wait. */
  busy?: boolean;
  /** The form inside is not complete yet: only confirm waits. */
  confirmDisabled?: boolean;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const open = defineModel<boolean>('open', { required: true });
defineSlots<{ default(): unknown }>();

const { t } = useI18n();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const headingId = useId();

watch(
  [open, dialog],
  ([isOpen, element]) => {
    if (element === null) return;
    if (isOpen && !element.open) element.showModal();
    if (!isOpen && element.open) element.close();
  },
  { flush: 'post' },
);

function cancel(): void {
  open.value = false;
  emit('cancel');
}
</script>

<template>
  <dialog ref="dialog" class="confirm" :aria-labelledby="headingId" @cancel.prevent="cancel">
    <h2 :id="headingId">{{ title }}</h2>
    <slot />
    <div class="actions">
      <button type="button" :disabled="busy" @click="cancel">{{ t('common.cancel') }}</button>
      <button
        type="button"
        class="danger"
        :disabled="busy || confirmDisabled"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
