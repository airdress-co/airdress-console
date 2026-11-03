import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { bundlePackages } from './build/bundle-packages.ts';

// The version this build is published as: the release workflow sets it from
// the tag; a local build says it is a development one. It prefixes the OAuth
// state so the entry document can return the hub's answer to this build
// (CONTRIBUTING.md, "The callback contract").
function consoleVersion(): string {
  const fromEnv = process.env['CONSOLE_VERSION'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const pkg: unknown = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const version =
    typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string'
      ? pkg.version
      : '0.0.0';
  return `${version}-dev`;
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
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
