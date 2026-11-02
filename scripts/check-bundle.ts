// SPEC-184 NFR-1 and NFR-8, checked on the production build (run after
// `vite build`). Every package in the bundle runs on the origin that holds an
// owner's operator token, so the list is held to bundle-allowlist.json;
// installs that never reach the browser are not this check's business.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_GZIP_BYTES = 200 * 1024;

function readStringList(path: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === 'string')) {
    throw new Error(`${path} is not a JSON list of package names`);
  }
  return parsed;
}

const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\s*\(/, 'new Function('],
  [/VueQueryDevtools/, 'the vue-query devtools'],
];

const failures: string[] = [];
const allowed = new Set(readStringList('bundle-allowlist.json'));
const bundled = readStringList('build-meta/bundle-packages.json');

for (const name of bundled) {
  if (!allowed.has(name)) {
    failures.push(
      `${name} is in the bundle but not in bundle-allowlist.json (add it by a reviewed change, with a reason)`,
    );
  }
  if (name.includes('devtools')) failures.push(`${name}: devtools must never ship`);
}

let gzipTotal = 0;
for (const file of readdirSync('dist/assets').filter((name) => /\.(js|css)$/.test(name))) {
  const source = readFileSync(join('dist/assets', file));
  gzipTotal += gzipSync(source, { level: 9 }).length;
  if (!file.endsWith('.js')) continue;
  const text = source.toString('utf8');
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(text)) failures.push(`${file} contains ${label} (the CSP forbids it)`);
  }
}

// An upper bound on the entry route: every asset, not only the ones it loads.
if (gzipTotal > BUDGET_GZIP_BYTES) {
  failures.push(
    `assets are ${String(gzipTotal)} bytes gzipped, over the ${String(BUDGET_GZIP_BYTES)} byte budget`,
  );
}

const unused = [...allowed].filter((name) => !bundled.includes(name));
process.stdout.write(
  `bundle: ${String(bundled.length)} packages, ${(gzipTotal / 1024).toFixed(1)} KiB gzipped (all assets)\n`,
);
if (unused.length > 0) process.stdout.write(`allowlisted but not bundled: ${unused.join(', ')}\n`);
for (const failure of failures) process.stderr.write(`check-bundle: ${failure}\n`);
process.exitCode = failures.length > 0 ? 1 : 0;
