import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { bundlePackages } from './build/bundle-packages.ts';

// The version this build is published as. Only the release tag knows it:
// publish.yml sets CONSOLE_VERSION from the tag, and package.json's version
// is never used (nothing bumps it; main takes no release commits). Any other
// build is a development one. It prefixes the OAuth state so the entry
// document can return the hub's answer to this build (CONTRIBUTING.md, "The
// callback contract").
function consoleVersion(): string {
  const fromEnv = process.env['CONSOLE_VERSION'];
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : '0.0.0-dev';
}

function previewHeaders(): Record<string, string> {
  const raw = process.env['E2E_SECURITY_HEADERS'];
  return raw === undefined || raw === '' ? {} : (JSON.parse(raw) as Record<string, string>);
}

// Every release is served under its own immutable prefix (/v/<semver>/), so
// asset URLs are relative and the build never assumes where it lives.
export default defineConfig({
  base: './',
  plugins: [vue(), bundlePackages('build-meta/bundle-packages.json')],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __CONSOLE_VERSION__: JSON.stringify(consoleVersion()),
    // Composition API only (design §3.2): the Options API is compiled out.
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    // vue-i18n compiles messages without eval (JIT); keep it that way.
    __INTLIFY_JIT_COMPILATION__: 'true',
    __INTLIFY_DROP_MESSAGE_COMPILER__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
    __VUE_I18N_FULL_INSTALL__: 'false',
    __VUE_I18N_LEGACY_API__: 'false',
  },
  // Only the end-to-end suite's production mode sets this (E2E_BUILD=1 in
  // playwright.config.ts): the build is served with the security headers
  // console.airdress.co sends, so the policy is tested, not assumed.
  preview: {
    headers: previewHeaders(),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
