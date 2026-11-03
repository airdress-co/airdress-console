<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useSession } from '@/auth/session.ts';
import { AREAS } from '@/compat.ts';
import { fqdnOf } from '@/operator/connection.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { installSessionGuard, sessionTarget } from '@/router.ts';

const { t } = useI18n();
const session = useSession();
const router = useRouter();
const route = useRoute();
const op = useOperator();

installSessionGuard(router, session);
void router.isReady().then(async () => {
  const target = sessionTarget(
    route.name,
    session.signedIn.value,
    fqdnOf(session.resource.value) !== undefined,
  );
  if (target !== true) await router.replace(target);
});

const connected = computed(() => session.signedIn.value && op.fqdn.value !== undefined);

async function signOut(): Promise<void> {
  await session.signOut();
  await router.replace({ name: 'connect' });
}
</script>

<template>
  <a class="skip" href="#main">{{ t('app.skip') }}</a>
  <header class="shell-header">
    <span class="wordmark" aria-label="airdress console">
      airdress<span class="signal" aria-hidden="true">:</span> console
    </span>
    <span v-if="connected" class="operator" :title="t('app.connectedTo')">{{ op.fqdn.value }}</span>
    <RouterLink v-if="session.signedIn.value" :to="{ name: 'choose' }">{{
      t('app.switch')
    }}</RouterLink>
    <button v-if="session.signedIn.value" type="button" @click="signOut">
      {{ t('app.signOut') }}
    </button>
  </header>
  <div class="shell">
    <nav v-if="connected" class="shell-nav" :aria-label="t('app.navLabel')">
      <ul>
        <li v-for="area in AREAS" :key="area">
          <RouterLink :to="{ name: area }">{{ t(`nav.${area}`) }}</RouterLink>
        </li>
      </ul>
    </nav>
    <main id="main" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<style>
/* The product palette (airdress-ops brand/colors.md). Dark is the default;
   light follows the system. No inline styles anywhere: the CSP forbids them. */
:root {
  --color-void: #111110;
  --color-surface: #2c2c2a;
  --color-muted: #a8a69e;
  --color-chalk: #f1efe8;
  --color-signal: #00d4aa;
  --color-signal-text: #00d4aa;
  --color-fault: #ff6b6a;
  --color-relay: #ef9f27;
  --color-border: #444441;
  --bg: var(--color-void);
  --panel: var(--color-surface);
  --text: var(--color-chalk);
  --muted: var(--color-muted);
  --accent: var(--color-signal-text);
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  color-scheme: dark light;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f1efe8;
    --panel: #ffffff;
    --text: #111110;
    --muted: #55544f;
    --accent: #0f6e56;
    --color-border: #c9c6bc;
    --color-fault: #b42a29;
    --color-relay: #8a5300;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.5;
}

a {
  color: var(--accent);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.skip {
  position: absolute;
  left: -999px;
}

.skip:focus {
  left: 1rem;
  top: 1rem;
  z-index: 10;
  background: var(--panel);
  padding: 0.5rem 1rem;
}

.shell-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.wordmark {
  font-family: var(--font-mono);
  font-weight: 600;
}

.signal {
  color: var(--accent);
}

.operator {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.shell {
  display: flex;
  min-height: calc(100vh - 3.5rem);
}

.shell-nav ul {
  list-style: none;
  margin: 0;
  padding: 1rem 0.75rem;
  min-width: 11rem;
  border-right: 1px solid var(--color-border);
}

.shell-nav a {
  display: block;
  padding: 0.4rem 0.75rem;
  color: var(--text);
  text-decoration: none;
  border-radius: 6px;
}

.shell-nav a.router-link-active {
  background: var(--panel);
  color: var(--accent);
}

main {
  flex: 1;
  padding: 1.5rem 2rem;
  max-width: 72rem;
}

@media (max-width: 720px) {
  .shell {
    flex-direction: column;
  }

  .shell-nav ul {
    display: flex;
    flex-wrap: wrap;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  main {
    padding: 1rem;
  }
}

h1 {
  font-size: 1.5rem;
  margin-top: 0;
}

h2 {
  font-size: 1.125rem;
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

button {
  background: var(--panel);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}

button.danger {
  border-color: var(--color-fault);
  color: var(--color-fault);
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

input,
select,
textarea {
  background: var(--bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
}

label {
  display: block;
  font-weight: 500;
  margin-top: 0.75rem;
}

.hint {
  color: var(--muted);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5rem 0 1.5rem;
}

th,
td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

th {
  color: var(--muted);
  font-weight: 500;
  font-size: 0.875rem;
}

.mono {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

.notice {
  background: var(--panel);
  border-left: 3px solid var(--color-relay);
  padding: 0.75rem 1rem;
  border-radius: 4px;
}

.notice-error {
  border-left-color: var(--color-fault);
}

.notice-ok {
  border-left-color: var(--accent);
}

.quote {
  color: var(--muted);
  font-size: 0.875rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.form {
  background: var(--panel);
  padding: 1rem;
  border-radius: 8px;
  margin: 1rem 0;
  max-width: 36rem;
}

.form .actions,
dialog .actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.status-on {
  color: var(--accent);
}

.status-off {
  color: var(--muted);
}

dialog {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  max-width: 32rem;
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.6);
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
}

.checks label {
  font-weight: 400;
  margin-top: 0.25rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.4rem 1.5rem;
}

.facts dt {
  color: var(--muted);
}

.facts dd {
  margin: 0;
}

.switches,
.conditions,
.outcomes {
  list-style: none;
  padding: 0;
}

.switches li,
.conditions li,
.outcomes li {
  padding: 0.25rem 0;
}

fieldset {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-top: 0.75rem;
}

.airdresses {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.5rem;
  max-width: 36rem;
}

button.airdress {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.75rem 1rem;
  text-align: left;
}

.airdress-name {
  font-weight: 600;
}

pre.logs {
  background: var(--bg);
  border: 1px solid var(--color-border);
  padding: 0.75rem;
  overflow: auto;
  max-height: 24rem;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
</style>
