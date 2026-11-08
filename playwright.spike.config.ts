import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The renderer spike (SPEC-189 189-0.2) against the built pages, served with
// the production CSP. WebKit's private libraries as in playwright.config.ts.
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
  testDir: 'spike/e2e',
  testMatch: '*.spike.ts',
  workers: 1,
  timeout: 300_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:47950', viewport: { width: 1280, height: 800 } },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
        launchOptions: { env: { ...process.env, ...webkitEnv } },
      },
    },
  ],
  webServer: {
    command: 'node spike/serve.mjs',
    url: 'http://127.0.0.1:47950/spike/network.html',
    reuseExistingServer: false,
  },
});
