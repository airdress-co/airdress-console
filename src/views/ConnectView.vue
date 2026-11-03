<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/auth/session.ts';
import { authConfig, hubApiResource, operatorResource } from '@/config.ts';
import { parseFqdn } from '@/fqdn.ts';
import type { ConnectRefusal } from '@/operator/connection.ts';
import { ConnectRefusedError, checkOperator } from '@/operator/connection.ts';
import { useOperator } from '@/operator/use-operator.ts';

/**
 * Two ways in. Signing in lists the airdresses the person owns (FR-16), the
 * common case, with no address to type. Connecting by address is for an
 * operator the hub does not list (FR-17): before any token is asked for, its
 * RFC 9728 document must name the hub and the console's scope; an operator
 * that does not is refused here, with the reason.
 */
const { t } = useI18n();
const session = useSession();
const op = useOperator();
const config = authConfig(window.location.origin, import.meta.env);
const issuer = config.issuer;

async function signIn(): Promise<void> {
  busy.value = true;
  await session.signIn(hubApiResource(config), '/choose');
}

const input = ref('');
const submitted = ref(false);
const busy = ref(false);
const refusal = ref<ConnectRefusal | undefined>(undefined);
const fqdn = computed(() => parseFqdn(input.value));
const showInvalid = computed(() => submitted.value && fqdn.value === undefined);

async function connect(): Promise<void> {
  submitted.value = true;
  refusal.value = undefined;
  const target = fqdn.value;
  if (target === undefined) return;
  busy.value = true;
  try {
    await checkOperator(op.fetch, target, issuer);
    await session.signIn(operatorResource(target), '/overview');
  } catch (error: unknown) {
    refusal.value = error instanceof ConnectRefusedError ? error.reason : 'unreachable';
    busy.value = false;
  }
}
</script>

<template>
  <section class="connect" aria-labelledby="connect-heading">
    <h1 id="connect-heading">{{ t('connect.heading') }}</h1>
    <p>{{ t('connect.lead') }}</p>
    <div class="form">
      <button type="button" class="primary" :disabled="busy" @click="signIn">
        {{ t('connect.signIn') }}
      </button>
    </div>
    <h2>{{ t('connect.byAddressHeading') }}</h2>
    <p class="hint">{{ t('connect.byAddressLead') }}</p>
    <form class="form" novalidate @submit.prevent="connect">
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
      <p id="fqdn-hint" class="hint">
        {{ showInvalid ? t('connect.invalid') : t('connect.fqdnHint') }}
      </p>
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy">{{ t('connect.submit') }}</button>
      </div>
    </form>
    <p v-if="refusal !== undefined" class="notice notice-error" role="alert">
      {{ t(`connect.refused.${refusal}`) }}
    </p>
  </section>
</template>
