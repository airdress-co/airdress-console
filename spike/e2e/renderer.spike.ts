// RDR-093 §7.5 measurements for SPEC-189 189-0.2. Each test writes its numbers
// to spike/results/<browser>-<name>.json; the report is assembled from those.
import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const REPLAY_MS = Number(process.env['SPIKE_REPLAY_MS'] ?? 30_000);

function save(browser: string, name: string, data: unknown): void {
  mkdirSync('spike/results', { recursive: true });
  writeFileSync(`spike/results/${browser}-${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => 'spike' in window || '__spike' in window);
}

test('H, Canvas 2D at the fixture size', async ({ page, browserName }) => {
  await open(page, '/spike/network.html?n=300&seed=7');
  const meta = await page.evaluate(() => {
    const s = (window as unknown as { __spike: Record<string, unknown> }).__spike;
    return {
      n: s['n'],
      edges: s['edges'],
      events: s['events'],
      layoutMs: s['layoutMs'],
      hash: s['hash'],
    };
  });
  const stability = await page.evaluate(() =>
    (window as unknown as { __spike: { stability: () => unknown } }).__spike.stability(),
  );
  const fit = await page.evaluate(
    (ms) =>
      (
        window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
      ).__spike.replay(ms),
    REPLAY_MS,
  );
  const zoomed = await page.evaluate(
    (ms) =>
      (
        window as unknown as { __spike: { replay: (ms: number, s: number) => Promise<unknown> } }
      ).__spike.replay(ms, 1),
    REPLAY_MS,
  );

  // Theme switch, then export: neither may trip the CSP.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    (window as unknown as { __spike: { retheme: () => void } }).__spike.retheme();
  });
  const png = await page.evaluate(() =>
    (window as unknown as { __spike: { exportPng: () => Promise<unknown> } }).__spike.exportPng(),
  );
  await page.emulateMedia({ colorScheme: 'light' });

  // Keyboard walk over the proxy layer.
  const listbox = page.getByRole('listbox');
  await page.keyboard.press('Tab');
  await expect(listbox).toBeFocused();
  const walk: string[] = [];
  for (const key of [
    'ArrowDown',
    'ArrowDown',
    'ArrowRight',
    'ArrowRight',
    'ArrowUp',
    'ArrowLeft',
    'Enter',
    'Escape',
  ]) {
    await page.keyboard.press(key);
    const active = await listbox.getAttribute('aria-activedescendant');
    walk.push(`${key}→${active ?? 'none'}`);
  }
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const scrubber = page.getByRole('slider', { name: 'Time' });
  await scrubber.focus();
  await page.keyboard.press('Home');
  const before = await scrubber.getAttribute('aria-valuetext');
  await page.keyboard.press('ArrowRight');
  const oneStep = await scrubber.getAttribute('aria-valuetext');
  await page.keyboard.press('PageUp');
  const after = await scrubber.getAttribute('aria-valuetext');
  const live = await page.locator('[aria-live="polite"]').textContent();

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = await page.evaluate(
    () => (window as unknown as { __spike: { violations: string[] } }).__spike.violations,
  );

  const result = {
    meta,
    stability,
    replay: { fit, zoomed },
    png,
    keyboard: { walk, scrubber: { before, oneStep, after }, live },
    axe: axe.violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}) × ${String(v.nodes.length)}`),
    csp: violations,
  };
  // The same replay with the raster finished inside the timer.
  await open(page, '/spike/network.html?n=300&seed=7&flush=1');
  const flushed = await page.evaluate(
    (ms) =>
      (
        window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
      ).__spike.replay(ms),
    REPLAY_MS,
  );
  save(browserName, 'h-300', { ...result, flushed });
  expect(violations).toEqual([]);
});

test('A, Cytoscape.js at the fixture size', async ({ page, browserName }) => {
  await open(page, '/spike/cyto.html?n=300&seed=7');
  const replay = await page.evaluate(
    (ms) =>
      (
        window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
      ).__spike.replay(ms),
    REPLAY_MS,
  );
  const png = await page.evaluate(() =>
    (window as unknown as { __spike: { exportPng: () => unknown } }).__spike.exportPng(),
  );
  const violations = await page.evaluate(
    () => (window as unknown as { __spike: { violations: string[] } }).__spike.violations,
  );
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll('style')].map((s) => ({
      id: s.id,
      text: s.textContent.slice(0, 200),
    })),
  );
  save(browserName, 'a-300', { replay, png, csp: violations, injectedStyles: styles });
});

test('H, scaling to the WebGL threshold', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for the curve');
  const rows: unknown[] = [];
  for (const n of [300, 1_000, 3_000, 10_000, 30_000]) {
    await open(page, `/spike/network.html?n=${String(n)}&seed=7&flush=1`);
    const meta = await page.evaluate(() => {
      const s = (window as unknown as { __spike: Record<string, unknown> }).__spike;
      return { n: s['n'], edges: s['edges'], events: s['events'], layoutMs: s['layoutMs'] };
    });
    const fit = await page.evaluate(
      (ms) =>
        (
          window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
        ).__spike.replay(ms),
      10_000,
    );
    const zoomed = await page.evaluate(
      (ms) =>
        (
          window as unknown as { __spike: { replay: (ms: number, s: number) => Promise<unknown> } }
        ).__spike.replay(ms, 1),
      10_000,
    );
    rows.push({ meta, fit, zoomed });
  }
  save(browserName, 'h-scaling', rows);
});

test('H, heap after ten replays and an unmount', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'performance.memory is Chromium-only');
  await open(page, '/spike/network.html?n=300&seed=7');
  const client = await page.context().newCDPSession(page);
  const heap = async (): Promise<number> => {
    await client.send('HeapProfiler.collectGarbage');
    const { usedSize } = await client.send('Runtime.getHeapUsage');
    return Math.round(usedSize / 1024);
  };
  const start = await heap();
  const after: number[] = [];
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() =>
      (
        window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
      ).__spike.replay(1_000),
    );
    after.push(await heap());
  }
  save(browserName, 'h-heap', { startKiB: start, afterEachReplayKiB: after });
});

test('H, the two levers: static-layer cache and no dashes', async ({ page, browserName }) => {
  const rows: Record<string, unknown> = {};
  const sizes = (process.env['SPIKE_SIZES'] ?? '300,1000,3000').split(',').map(Number);
  const opts = (process.env['SPIKE_OPTS'] ?? 'plain;nodash;cache;cache,nodash').split(';');
  const flushes = (process.env['SPIKE_FLUSH'] ?? '0,1').split(',');
  for (const n of sizes) {
    for (const opt of opts) {
      for (const flush of flushes) {
        await open(page, `/spike/network.html?n=${String(n)}&seed=7&flush=${flush}&opt=${opt}`);
        rows[`${String(n)} ${opt} flush=${flush}`] = await page.evaluate(
          (ms) =>
            (
              window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
            ).__spike.replay(ms),
          10_000,
        );
      }
    }
  }
  save(
    browserName,
    `h-levers-${process.env['SPIKE_MODE'] ?? 'headless'}${process.env['SPIKE_TAG'] ?? ''}`,
    rows,
  );
});

test('Presets: screenshots', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine for pictures');
  mkdirSync('spike/results', { recursive: true });
  for (const n of [60, 300]) {
    for (const preset of ['columns', 'groups', 'free']) {
      await open(
        page,
        `/spike/network.html?n=${String(n)}&seed=7&preset=${preset}&opt=cache,nodash&fixture=household`,
      );
      await page.evaluate(() => {
        const s = (window as unknown as { __spike: { replayTo?: unknown } }).__spike;
        return s;
      });
      await page.evaluate(() =>
        (
          window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
        ).__spike.replay(300),
      );
      await page
        .locator('canvas')
        .screenshot({ path: `spike/results/look-${preset}-${String(n)}.png` });
    }
    await page.evaluate(() =>
      (window as unknown as { __spike: { focus: () => unknown } }).__spike.focus(),
    );
    await page.locator('canvas').screenshot({ path: `spike/results/look-focus-${String(n)}.png` });
  }
});

test('Presets: layout, determinism, quality, stability, frames, focus', async ({
  page,
  browserName,
}) => {
  const rows: Record<string, unknown> = {};
  const frames = process.env['SPIKE_MODE'] === 'headed';
  for (const fx of ['household', 'random']) {
    for (const n of [300, 1_000, 3_000]) {
      for (const preset of ['columns', 'groups', 'free']) {
        await open(
          page,
          `/spike/network.html?n=${String(n)}&seed=7&preset=${preset}&opt=cache,nodash&fixture=${fx}`,
        );
        const s = await page.evaluate((small) => {
          const w = (window as unknown as { __spike: Record<string, unknown> }).__spike;
          const q = w['quality'] as () => unknown;
          const st = w['stability'] as () => unknown;
          const f = w['focus'] as () => unknown;
          return {
            layoutMs: w['layoutMs'],
            hash: w['hash'],
            quality: small ? q() : null,
            stability: small ? st() : null,
            focus: f(),
          };
        }, n === 300);
        const replay = frames
          ? await page.evaluate(() =>
              (
                window as unknown as { __spike: { replay: (ms: number) => Promise<unknown> } }
              ).__spike.replay(10_000),
            )
          : null;
        rows[`${fx} ${String(n)} ${preset}`] = { ...s, replay };
      }
    }
  }
  save(browserName, `presets-${process.env['SPIKE_MODE'] ?? 'headless'}`, rows);
});
