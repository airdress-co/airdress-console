// Records which node_modules packages end up in the production bundle, so
// scripts/check-bundle.ts can hold them to an allowlist (SPEC-184 NFR-8).
// It reads the bundler's own module graph: a package that is installed but
// never bundled (a build-time dependency of vue-router, say) is not listed,
// and one that is bundled cannot hide.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';

const NODE_MODULES = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g;

/** The package a module id belongs to: the last node_modules segment wins. */
export function packageOf(id: string): string | undefined {
  let name: string | undefined;
  for (const match of id.matchAll(NODE_MODULES)) {
    name = match[1]?.replaceAll('\\', '/');
  }
  return name;
}

export function bundlePackages(outFile: string): Plugin {
  return {
    name: 'airdress:bundle-packages',
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, rendered] of Object.entries(output.modules)) {
          if (rendered.renderedLength === 0) continue;
          const name = packageOf(id);
          if (name !== undefined) packages.add(name);
        }
      }
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, `${JSON.stringify([...packages].sort(), null, 2)}\n`);
    },
  };
}
