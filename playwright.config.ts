import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { AS_ORIGIN, CONSOLE_ORIGIN, CONSOLE_PORT, OPERATOR_ORIGIN } from './e2e/harness/env.ts';

// End-to-end tests (SPEC-184 184-D.13): the console in three browsers, a real
// airdress-operator and a fake hub authorization server. See e2e/README.md.

// WebKit on a host without its system libraries (this workstation, Ubuntu
// 26.04): e2e/webkit-libs.sh unpacks the three it needs into a private
// directory, without installing anything. They are preloaded, because
// WebKit's launcher replaces LD_LIBRARY_PATH; the library path is also set
// on this process for Playwright's own pre-launch check. CI installs them
// with `playwright install --with-deps` instead.
const webkitLibs =
  process.env['AIRDRESS_WEBKIT_LIBS'] ??
  join(homedir(), '.cache/playwright-webkit-libs/root/usr/lib/x86_64-linux-gnu');
const webkitEnv: Record<string, string> = {};
if (existsSync(webkitLibs)) {
  process.env['LD_LIBRARY_PATH'] = [webkitLibs, process.env['LD_LIBRARY_PATH'] ?? '']
    .filter((p) => p !== '')
    .join(':');
  // WebKit 2370 (Playwright 1.64) also needs libavif and its two decoders.
  webkitEnv['LD_PRELOAD'] = [
    'libevent-2.1.so.7',
    'libmanette-0.2.so.0',
    'libhidapi-hidraw.so.0',
    'libyuv.so.0',
    'libgav1.so.1',
    'libavif.so.16',
  ]
    .map((lib) => join(webkitLibs, lib))
    .filter((path) => existsSync(path))
    .join(':');
}

// E2E_BUILD=1: the production build under console.airdress.co's own security
// headers (security-headers.json), not the dev server, which sends none. One
// change, for the harness: connect-src names the harness's servers instead
// of account.airdress.co and the airdress zone. Trusted Types are enforced
// as shipped, so a sink fails the test.
const productionMode = process.env['E2E_BUILD'] === '1';

function harnessHeaders(): Record<string, string> {
  const file = JSON.parse(readFileSync('security-headers.json', 'utf8')) as Record<string, string>;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(file)) {
    if (!name.startsWith('$')) headers[name] = value;
  }
  headers['Content-Security-Policy'] = (file['Content-Security-Policy'] ?? '')
    .split(';')
    .map((d) => d.trim())
    .map((d) =>
      d.startsWith('connect-src') ? `connect-src 'self' ${AS_ORIGIN} ${OPERATOR_ORIGIN}` : d,
    )
    .join('; ');
  return headers;
}

const buildEnv = {
  VITE_AUTH_ISSUER: AS_ORIGIN,
  VITE_E2E_OPERATOR_ORIGIN: OPERATOR_ORIGIN,
  VITE_AIRDRESS_ZONE: 'e2e.test',
};

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  // One operator and one authorization server serve every test: run them in order.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: CONSOLE_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        launchOptions: { env: { ...process.env, ...webkitEnv } },
      },
    },
    {
      // Safari on iOS is WebKit with a phone's viewport, touch and user
      // agent; with no iOS device in the lab, this is AC-11's iOS half.
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 15'],
        launchOptions: { env: { ...process.env, ...webkitEnv } },
      },
    },
  ],
  webServer: productionMode
    ? {
        // Built as a release is, served with its headers. /callback falls back
        // to the entry, which the build reads like the dev server's.
        command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${String(CONSOLE_PORT)} --strictPort`,
        url: CONSOLE_ORIGIN,
        reuseExistingServer: false,
        timeout: 180_000,
        env: { ...buildEnv, E2E_SECURITY_HEADERS: JSON.stringify(harnessHeaders()) },
      }
    : {
        // The dev server: it handles /callback directly (CONTRIBUTING.md, "The
        // callback contract"). The VITE_ values point the console at the
        // harness; a published build sets none of them.
        command: `npx vite --host 127.0.0.1 --port ${String(CONSOLE_PORT)} --strictPort`,
        url: CONSOLE_ORIGIN,
        reuseExistingServer: false,
        env: buildEnv,
      },
});
