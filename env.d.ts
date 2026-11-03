/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The hub authorization server's issuer, e.g. https://account.airdress.co */
  readonly VITE_AUTH_ISSUER?: string;
  /** This console's OAuth client id at the hub. */
  readonly VITE_AUTH_CLIENT_ID?: string;
}

/** The version this build is published as (vite.config.ts). */
declare const __CONSOLE_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// For tools that read TypeScript without Vue's language plugin (type-aware
// ESLint). vue-tsc resolves the real component types and ignores this.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
