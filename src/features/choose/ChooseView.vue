<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { useSession } from '@/auth/session.ts';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { authConfig, hubApiResource, operatorResource } from '@/config.ts';
import type { OwnedAirdress } from './api.ts';
import { useOwnedAirdresses } from './api.ts';

/**
 * Choose which of your airdresses to administer (FR-16). The list comes from
 * the hub with a hub-API token; choosing one re-scopes the same sign-in to
 * that operator, with no new sign-in.
 */
const { t } = useI18n();
const session = useSession();
const router = useRouter();
const hubResource = hubApiResource(authConfig(window.location.origin, import.meta.env));

const ready = ref(false);
const prepareError = ref<unknown>(null);
const choosing = ref<string | undefined>(undefined);
const chooseError = ref<unknown>(null);
const owned = useOwnedAirdresses(ready);
const rows = computed(() => owned.data.value ?? []);

/** The list needs a hub-API token; coming back from an operator re-scopes to it. */
async function prepare(): Promise<void> {
  try {
    if (session.resource.value !== hubResource) await session.switchTo(hubResource);
    ready.value = true;
  } catch (error: unknown) {
    prepareError.value = error;
  }
}
void prepare();

async function choose(airdress: OwnedAirdress): Promise<void> {
  choosing.value = airdress.fqdn;
  chooseError.value = null;
  try {
    await session.switchTo(operatorResource(airdress.fqdn));
    await router.push({ name: 'overview' });
  } catch (error: unknown) {
    chooseError.value = error;
    choosing.value = undefined;
  }
}
</script>

<template>
  <section aria-labelledby="choose-heading">
    <h1 id="choose-heading">{{ t('choose.heading') }}</h1>
    <p class="hint">{{ t('choose.lead') }}</p>
    <ErrorNotice v-if="prepareError !== null" :error="prepareError" />
    <ErrorNotice v-if="chooseError !== null" :error="chooseError" />
    <ErrorNotice v-if="owned.error.value !== null" :error="owned.error.value" />
    <p v-else-if="!ready || owned.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="rows.length === 0">{{ t('choose.none') }}</p>
    <ul v-else class="airdresses">
      <li v-for="a in rows" :key="a.id">
        <button
          type="button"
          class="airdress"
          :disabled="choosing !== undefined"
          :aria-busy="choosing === a.fqdn"
          @click="choose(a)"
        >
          <span class="airdress-name">{{ a.label ?? a.name }}</span>
          <span class="mono hint">{{ a.fqdn }}</span>
          <span v-if="a.status !== 'active'" class="hint">{{ a.status }}</span>
        </button>
      </li>
    </ul>
    <p>
      <RouterLink :to="{ name: 'connect', query: { by: 'address' } }">{{
        t('choose.byAddress')
      }}</RouterLink>
    </p>
  </section>
</template>
