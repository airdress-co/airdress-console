import { defineConfig } from 'vite';

// The entry document (SPEC-184 design §4): served at the site root and at
// /callback, so its assets are absolute (/assets/…). Built after the app into
// dist/_entry/; `just console-promote` copies it to the bucket root.
export default defineConfig({
  root: 'entry',
  base: '/',
  build: {
    outDir: '../dist/_entry',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: false,
    rolldownOptions: {
      output: { entryFileNames: 'assets/entry-[hash].js' },
    },
  },
});
