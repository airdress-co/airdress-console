import { VueQueryPlugin } from '@tanstack/vue-query';
import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import { SIGN_OUT_CHANNEL, SessionKey, createSession, resumeRoute } from './auth/session.ts';
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
  tabs: new BroadcastChannel(SIGN_OUT_CHANNEL),
});
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

// A reload, or a switch to another console version in this tab, forgot the
// tokens (FR-13). Start the sign-in again for the operator this tab was on,
// before anything renders: while the hub's session lives it comes straight
// back, to the same route, without a page the person has to answer.
const resuming = !isCallback && (await session.resume(resumeRoute(window.location.hash)));

// Only now: a hash history reads the location when it is created, so a
// router made before the callback rewrote the URL would navigate to the
// address bar's old `#/` instead of the route the sign-in returned to
// (found by the end-to-end suite: sign-in landed on connect, not choose).
// Resuming navigates away: mounting now would only flash the connect page.
if (!resuming) {
  const router = createConsoleRouter();

  createApp(App)
    .provide(SessionKey, session)
    .use(VueQueryPlugin, { queryClient })
    .use(router)
    .use(i18n)
    .mount('#app');
}
