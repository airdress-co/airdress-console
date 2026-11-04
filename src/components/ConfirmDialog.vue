<script setup lang="ts">
import { inject, ref, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SessionKey } from '@/auth/session.ts';
import { freshSignInLikely } from '@/operator/step-up.ts';

/**
 * Every destructive action asks first, naming the thing (FR-37). A native
 * <dialog>: focus is trapped and Escape cancels without code of our own.
 */
const {
  title,
  confirmLabel,
  busy,
  confirmDisabled,
  resumed = 'none',
} = defineProps<{
  title: string;
  confirmLabel: string;
  /**
   * The action is offered again after a step-up sign-in (FR-42): `confirm`
   * to confirm it, `form` to fill its form in once more.
   */
  resumed?: 'confirm' | 'form' | 'none';
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
// Optional: a dialog rendered without a session (a unit test) warns of nothing.
const session = inject(SessionKey, undefined);
/**
 * Said before the write, decided when the dialog opens: a sign-in older than
 * the step-up window will be sent to sign in again first. Without this the
 * person confirms, is taken to the sign-in page and has to confirm again,
 * which read as being signed out (2026-11-04, a reused session).
 */
const signInAhead = ref(false);

watch(
  [open, dialog],
  ([isOpen, element]) => {
    if (element === null) return;
    if (isOpen && !element.open) {
      signInAhead.value = freshSignInLikely(session?.signedInAt());
      element.showModal();
    }
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
    <!-- One sentence, the true one: a resumed action whose sign-in is already
         stale again (a reused id.airdress.co session, 2026-11-04) is not one
         the person "signed in again" for, and said both at once. -->
    <p v-if="signInAhead" class="hint">{{ t('stepUp.ahead') }}</p>
    <p v-else-if="resumed !== 'none'">
      {{ t(resumed === 'form' ? 'stepUp.resumedForm' : 'stepUp.resumed') }}
    </p>
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
