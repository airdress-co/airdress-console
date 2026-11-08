// The network view's proof of concept (SPEC-189): a real operator built with
// GET /v1/admin/network, a household seeded into its database, and the
// console's Network area read through it in every arrangement. Screenshots
// go to spike/results/poc-*.png for review.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { OPERATOR_FQDN } from './harness/env.ts';

const SHOTS = 'spike/results';

/** Seed the household straight into the e2e operator's embedded PostgreSQL. */
function seed(): void {
  const root = process.env['E2E_OPERATOR_ROOT'];
  if (root === undefined) throw new Error('E2E_OPERATOR_ROOT is not set (harness/operator.ts)');
  const pg = join(root, 'pg');
  const sockets = join(pg, 'sockets');
  const socket = readdirSync(sockets).find(
    (f) => f.startsWith('.s.PGSQL.') && !f.endsWith('.lock'),
  );
  if (socket === undefined) throw new Error(`no PostgreSQL socket in ${sockets}`);
  const port = socket.slice('.s.PGSQL.'.length);
  const password = readFileSync(join(pg, '.airdress_pg_password'), 'utf8').trim();
  execFileSync(
    'psql',
    [
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-h',
      sockets,
      '-p',
      port,
      '-U',
      'postgres',
      '-d',
      'airdress',
      '-f',
      'e2e/network-seed.sql',
    ],
    { env: { ...process.env, PGPASSWORD: password }, stdio: 'pipe' },
  );
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose an airdress' })).toBeVisible();
  await page
    .getByRole('button', { name: new RegExp(OPERATOR_FQDN.replaceAll('.', '\\.')) })
    .click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

test('the network area reads the operator and shows every arrangement', async ({ page }) => {
  test.setTimeout(180_000);
  seed();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Network' }).click();
  await expect(page.getByRole('heading', { name: 'Network', level: 1 })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await expect(page.getByText(/associations; \d+ events/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // WCAG 2.2 A and AA, as every other area (184-D.14).
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id} × ${String(v.nodes.length)}`)).toEqual([]);

  for (const arrangement of ['Groups', 'Columns', 'Free']) {
    await page.getByRole('button', { name: arrangement, exact: true }).click();
    await page.screenshot({
      path: `${SHOTS}/poc-${arrangement.toLowerCase()}.png`,
      fullPage: true,
    });
  }

  // Keyboard: into the graph, walk to a device, select it, focus on it.
  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await page.getByRole('listbox').focus();
  for (const key of ['ArrowRight', 'ArrowRight', 'Enter']) await page.keyboard.press(key);
  await expect(page.getByRole('complementary').getByRole('heading', { level: 2 })).toBeVisible();
  await page.keyboard.press('f');
  await page.screenshot({ path: `${SHOTS}/poc-focus.png`, fullPage: true });
  await page.keyboard.press('Escape');

  // Replay to the middle of the week, then the table as of that moment.
  const slider = page.getByRole('slider', { name: 'Time' });
  await slider.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: `${SHOTS}/poc-replay.png`, fullPage: true });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/poc-table.png`, fullPage: true });

  // The export is a CSV of every interval in the window.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv.split('\n')[0]).toBe('subject,association,object,from,until,closed_by,reconstructed');
  expect(csv).toContain('holds_device');
});
