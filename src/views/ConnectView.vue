<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/auth/session.ts';
import { operatorResource } from '@/config.ts';
import { parseFqdn } from '@/fqdn.ts';

// A placeholder until the owner has reviewed the Figma screens (184-0.9).
// It proves the architecture: a typed composable, local form state, and a
// sign-in that leaves the tokens to the session.
const { t } = useI18n();
const session = useSession();

const input = ref('');
const submitted = ref(false);
const fqdn = computed(() => parseFqdn(input.value));
const showInvalid = computed(() => submitted.value && fqdn.value === undefined);

async function connect(): Promise<void> {
  submitted.value = true;
  if (fqdn.value === undefined) return;
  await session.signIn(operatorResource(fqdn.value), '/');
}
</script>

<template>
  <section class="connect">
    <h1>{{ t('connect.heading') }}</h1>
    <p>{{ t('connect.lead') }}</p>
    <form novalidate @submit.prevent="connect">
      <label for="fqdn">{{ t('connect.fqdnLabel') }}</label>
      <input
        id="fqdn"
        v-model="input"
        type="text"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :aria-invalid="showInvalid"
        aria-describedby="fqdn-hint"
      />
      <p id="fqdn-hint">{{ showInvalid ? t('connect.invalid') : t('connect.fqdnHint') }}</p>
      <button type="submit">{{ t('connect.submit') }}</button>
    </form>
  </section>
</template>
