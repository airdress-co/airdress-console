// SPEC-184 design §3.1: type-aware, strict, and every finding fails the build
// (`eslint --max-warnings 0`, and the presets used are the error variants).
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'dist-e2e/**',
      'build-meta/**',
      'node_modules/**',
      'coverage/**',
      'src/api/generated/**',
      // The renderer spike (SPEC-189 189-0.2): vendored d3 as published, and
      // the measurement harness, which never ships.
      'src/vendor/**',
      'spike/**',
      'dist-spike/**',
      'vite.spike.config.ts',
      'playwright.spike.config.ts',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...vue.configs['flat/recommended-error'],
  comments.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
    rules: {
      // No escape hatches without a reason.
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',

      // Banned dependencies: no store (TanStack Query owns server state), no
      // HTTP client (fetch), never the Vue build that compiles templates at
      // runtime (it needs eval, which the CSP forbids).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pinia',
              message: 'No global store: server state lives in TanStack Query (design §3.3).',
            },
            { name: 'axios', message: 'Use fetch through src/api/http.ts.' },
            { name: 'vue-demi', message: 'Import from vue.' },
          ],
          patterns: [
            {
              group: ['vue/dist/*'],
              message: 'The runtime build is the only Vue build (CSP: no eval).',
            },
            {
              group: ['@tanstack/vue-query-devtools'],
              message: 'Devtools are dev-only and never imported by app code.',
            },
          ],
        },
      ],

      // Idiomatic Vue 3 (design §3.2).
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': [
        'error',
        {
          order: ['defineOptions', 'defineProps', 'defineEmits', 'defineModel', 'defineSlots'],
          defineExposeLast: true,
        },
      ],
      'vue/define-props-declaration': ['error', 'type-based'],
      'vue/define-emits-declaration': ['error', 'type-literal'],
      'vue/define-props-destructuring': 'error',
      'vue/require-typed-ref': 'error',
      'vue/no-ref-object-reactivity-loss': 'error',
      'vue/no-setup-props-reactivity-loss': 'error',
      'vue/no-unused-properties': [
        'error',
        { groups: ['props', 'data', 'computed', 'methods', 'setup'] },
      ],
      'vue/no-unused-refs': 'error',
      'vue/no-unused-emit-declarations': 'error',
      'vue/no-undef-components': 'error',
      'vue/no-v-html': 'error',
      'vue/no-root-v-if': 'error',
      'vue/no-required-prop-with-default': 'error',
      'vue/no-boolean-default': ['error', 'default-false'],
      'vue/no-import-compiler-macros': 'error',
      'vue/prefer-use-template-ref': 'error',
      'vue/prefer-true-attribute-shorthand': 'error',
      'vue/require-explicit-slots': 'error',
      'vue/require-macro-variable-name': 'error',
      'vue/no-restricted-component-options': [
        'error',
        'data',
        'methods',
        'computed',
        'watch',
        'mixins',
        'extends',
        'filters',
      ],
      'vue/no-restricted-syntax': [
        'error',
        {
          selector: 'ThisExpression',
          message: 'No `this` in templates or components: Composition API only.',
        },
      ],
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    files: ['scripts/**/*.ts', 'build/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
