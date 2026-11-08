import { existsSync } from 'node:fs';
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
  webServer: {
    // The dev server: it handles /callback directly (CONTRIBUTING.md, "The
    // callback contract"). The two VITE_ origins point the console at the
    // harness; a published build sets neither.
    command: `npx vite --host 127.0.0.1 --port ${String(CONSOLE_PORT)} --strictPort`,
    url: CONSOLE_ORIGIN,
    reuseExistingServer: false,
    env: {
      VITE_AUTH_ISSUER: AS_ORIGIN,
      VITE_E2E_OPERATOR_ORIGIN: OPERATOR_ORIGIN,
    },
  },
});
