import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __CONSOLE_VERSION__: JSON.stringify('0.1.0'),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'build/**/*.test.ts', 'entry/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
