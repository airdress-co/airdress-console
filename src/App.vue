<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterView } from 'vue-router';
import { useSession } from '@/auth/session.ts';

const { t } = useI18n();
const session = useSession();
</script>

<template>
  <header class="shell-header">
    <span class="wordmark">airdress<span class="signal">:</span> console</span>
    <button v-if="session.signedIn.value" type="button" @click="session.signOut()">
      {{ t('app.signOut') }}
    </button>
  </header>
  <main>
    <RouterView />
  </main>
</template>
