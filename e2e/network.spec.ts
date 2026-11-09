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

interface Pg {
  readonly sockets: string;
  readonly port: string;
  readonly password: string;
  readonly root: string;
}

function pg(): Pg {
  const root = process.env['E2E_OPERATOR_ROOT'];
  if (root === undefined) throw new Error('E2E_OPERATOR_ROOT is not set (harness/operator.ts)');
  const sockets = join(root, 'pg', 'sockets');
  const socket = readdirSync(sockets).find(
    (f) => f.startsWith('.s.PGSQL.') && !f.endsWith('.lock'),
  );
  if (socket === undefined) throw new Error(`no PostgreSQL socket in ${sockets}`);
  const password = readFileSync(join(root, 'pg', '.airdress_pg_password'), 'utf8').trim();
  return { sockets, port: socket.slice('.s.PGSQL.'.length), password, root };
}

/** Run the operator's own CLI against the e2e operator; its stdout. */
function operatorCli(args: string[]): string {
  const binary = process.env['E2E_OPERATOR_BINARY'];
  const root = process.env['E2E_OPERATOR_ROOT'];
  if (binary === undefined || root === undefined) throw new Error('the e2e operator is not up');
  return execFileSync(binary, ['--config', join(root, 'operator.toml'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, AIRDRESS_PG_OFFLINE: '1' },
  });
}

function idOf(out: string): string {
  const id = /^id: ([0-9a-f-]{36})$/m.exec(out)?.[1];
  if (id === undefined) throw new Error(`no id in: ${out}`);
  return id;
}

/**
 * The household's week, as the operator records it: two people added and
 * one removed through the operator's own CLI (the real write paths, which
 * record their events), then the week's device, root, machine, grant and
 * shell events into the log. The view is drawn from what the operator's
 * projector makes of all of it; no association table is written here.
 */
function seed(): void {
  // One operator serves every browser project: the week is recorded once.
  if (/\bMia\b/.test(operatorCli(['sub-users', 'list']))) return;
  const mia = idOf(
    operatorCli(['sub-users', 'create', '--display-name', 'Mia', '--without-account']),
  );
  const ben = idOf(
    operatorCli(['sub-users', 'create', '--display-name', 'Ben', '--without-account']),
  );
  operatorCli(['sub-users', 'revoke', ben]);
  const db = pg();
  execFileSync(
    'psql',
    [
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-h',
      db.sockets,
      '-p',
      db.port,
      '-U',
      'postgres',
      '-d',
      'airdress',
      '-v',
      `mia=${mia}`,
      '-v',
      `ben=${ben}`,
      '-f',
      'e2e/network-events.sql',
    ],
    { env: { ...process.env, PGPASSWORD: db.password }, stdio: 'pipe' },
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

  // Off by default (D-13): the history is kept, the view is not shown
  // until the owner turns it on (FR-46).
  // (One operator serves every browser project: a later one finds it on.)
  const turnOn = page.getByRole('button', { name: 'Turn on the network view' });
  await expect(page.getByText(/associations; \d+ events/).or(turnOn)).toBeVisible();
  if (await turnOn.isVisible()) await turnOn.click();
  await expect(page.getByText(/associations; \d+ events/)).toBeVisible();

  // The projector runs on its own clock: reopen until it has drawn the week.
  const nav = page.getByRole('navigation');
  await expect(async () => {
    await nav.getByRole('link', { name: 'Overview' }).click();
    await nav.getByRole('link', { name: 'Network' }).click();
    await expect(page.getByRole('option', { name: /device iPad/ })).toHaveCount(1, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });
  for (const label of ['person Mia', 'person Ben', 'device Pixel 8', 'device Doogee X95Pro']) {
    await expect(page.getByRole('option', { name: label })).toHaveCount(1);
  }
  await expect(page.getByText(/History recorded since/)).toBeVisible();
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
  // Step to the last day: after the reset, with the NAS and its sessions.
  await page.keyboard.press('End');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
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
