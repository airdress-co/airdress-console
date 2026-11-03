import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { OPERATOR_FQDN } from './harness/env.ts';

// SPEC-184 NFR-5 (184-D.14): every screen against WCAG 2.2 A and AA with axe,
// in each browser, with real data from the operator behind it.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, where: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = result.violations.map(
    (v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) ${v.help} × ${String(v.nodes.length)}`,
  );
  expect(found).toEqual([]);
}

test('every screen meets WCAG 2.2 AA (axe)', async ({ page, browserName }) => {
  await page.goto('/');
  await audit(page, 'connect');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose an airdress' })).toBeVisible();
  await audit(page, 'choose');

  await page
    .getByRole('button', { name: new RegExp(OPERATOR_FQDN.replaceAll('.', '\\.')) })
    .click();
  for (const area of [
    'Overview',
    'People',
    'Devices',
    'Machines',
    'DNS subnames',
    'Shells',
    'Grants',
    'Functions',
  ]) {
    await page.getByRole('navigation').getByRole('link', { name: area }).click();
    await expect(page.getByRole('heading', { name: area, level: 1 })).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await audit(page, area);
  }

  // A dialog open, the one place focus is trapped.
  await page.getByRole('navigation').getByRole('link', { name: 'People' }).click();
  const person = `A11y ${browserName} ${String(Date.now())}`;
  await page.getByLabel('Name').fill(person);
  await page.getByRole('button', { name: 'Add person' }).click();
  const row = page.getByRole('row', { name: new RegExp(person) });
  await row.getByRole('button', { name: 'Block publishing' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit(page, 'confirm dialog');
});
