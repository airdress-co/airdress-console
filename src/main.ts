import { VueQueryPlugin } from '@tanstack/vue-query';
import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import { SessionKey, createSession } from './auth/session.ts';
import { createTokenVault } from './auth/vault.ts';
import { authConfig } from './config.ts';
import type { Locale, MessageSchema } from './i18n/index.ts';
import { messages, preferredLocale } from './i18n/index.ts';
import { createQueryClient } from './query/client.ts';
import { createConsoleRouter } from './router.ts';

const queryClient = createQueryClient();
const session = createSession({
  config: authConfig(window.location.origin, import.meta.env),
  vault: createTokenVault(),
  queryClient,
  storage: window.sessionStorage,
  fetch: (input, init) => window.fetch(input, init),
  navigate: (url) => {
    window.location.assign(url);
  },
});
const router = createConsoleRouter();
const i18n = createI18n<[MessageSchema], Locale, false>({
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- v11 still defaults to the Legacy API; v12 drops the option together with that mode, and this line with it.
  legacy: false,
  locale: preferredLocale(navigator.languages),
  fallbackLocale: 'en',
  messages,
});

// The hub redirects to /callback. Published, the entry document there hands
// the answer to this build as /v/<version>/?oauth=callback&…; under the dev
// server /callback reaches the app directly. Finish the sign-in, then drop the
// code and state from the address bar before the app renders, staying under
// this build's own path.
const here = new URL(window.location.href);
const isCallback = here.pathname === '/callback' || here.searchParams.get('oauth') === 'callback';
if (isCallback) {
  const home = here.pathname === '/callback' ? '/' : here.pathname;
  try {
    const returnTo = await session.completeSignIn(here);
    window.history.replaceState(null, '', `${home}#${returnTo}`);
  } catch {
    window.history.replaceState(null, '', home);
  }
}

createApp(App)
  .provide(SessionKey, session)
  .use(VueQueryPlugin, { queryClient })
  .use(router)
  .use(i18n)
  .mount('#app');
