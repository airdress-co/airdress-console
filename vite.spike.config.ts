// The renderer spike's build (SPEC-189 189-0.2): two pages, H (Canvas 2D) and
// A (Cytoscape.js), with a per-chunk record of the packages and gzip size
// of everything each page loads. Not part of the release build.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { gzipSync } from 'node:zlib';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { packageOf } from './build/bundle-packages.ts';

function perChunk(outFile: string): Plugin {
  return {
    name: 'spike:per-chunk',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks: Record<
        string,
        { gzip: number; raw: number; packages: string[]; imports: string[] }
      > = {};
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const packages = new Set<string>();
        for (const [id, rendered] of Object.entries(output.modules)) {
          if (rendered.renderedLength === 0) continue;
          const name = packageOf(id);
          if (name !== undefined) packages.add(name);
          else if (id.includes('/src/vendor/'))
            packages.add(`vendored:${id.split('/src/vendor/')[1]?.split('/')[1] ?? '?'}`);
        }
        chunks[output.fileName] = {
          raw: output.code.length,
          gzip: gzipSync(output.code, { level: 9 }).length,
          packages: [...packages].sort(),
          imports: output.imports,
        };
      }
      mkdirSync('build-meta', { recursive: true });
      writeFileSync(outFile, `${JSON.stringify(chunks, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), perChunk('build-meta/spike-chunks.json')],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    target: 'es2022',
    outDir: 'dist-spike',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: { input: { network: 'spike/network.html', cyto: 'spike/cyto.html' } },
  },
});
