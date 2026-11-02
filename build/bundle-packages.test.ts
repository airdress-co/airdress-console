import { describe, expect, it } from 'vitest';
import { packageOf } from './bundle-packages.ts';

describe('packageOf', () => {
  it('names plain and scoped packages, innermost node_modules first', () => {
    expect(packageOf('/x/node_modules/vue/dist/vue.runtime.esm-bundler.js')).toBe('vue');
    expect(packageOf('/x/node_modules/@tanstack/query-core/build/modern/index.js')).toBe(
      '@tanstack/query-core',
    );
    expect(
      packageOf('/x/node_modules/@tanstack/vue-query/node_modules/vue-demi/lib/index.mjs'),
    ).toBe('vue-demi');
    expect(packageOf('/x/src/main.ts')).toBeUndefined();
  });
});
