import type { Page, Request } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  AS_ORIGIN,
  CONSOLE_ORIGIN,
  OPERATOR_FQDN,
  OPERATOR_ORIGIN,
  STEP_UP_MAX_AGE_SECS,
} from './harness/env.ts';

// SPEC-184 184-D.13: the console against a real airdress-operator (v0.1.164)
// and a stand-in for the hub's authorization server, in Chromium, Firefox
// and WebKit. One operator serves every test, so names carry the browser.

async function signIn(page: Page): Promise<number> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The authorization server consents at once and returns to /callback.
  await expect(page.getByRole('heading', { name: 'Choose an airdress' })).toBeVisible();
  const signedInAt = Date.now();
  await page
    .getByRole('button', { name: new RegExp(OPERATOR_FQDN.replaceAll('.', '\\.')) })
    .click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return signedInAt;
}

async function asTest<T>(path: string): Promise<T> {
  const response = await fetch(`${AS_ORIGIN}${path}`);
  return (await response.json()) as T;
}

test('signs in, lists the airdress, reads the operator, and keeps tokens and requests where they belong', async ({
  page,
}) => {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));

  await signIn(page);
  await expect(page.getByText('v0.1.164')).toBeVisible();
  await expect(page.getByText('Serving')).toBeVisible();

  for (const area of ['People', 'Devices', 'Machines', 'Grants', 'Functions']) {
    await page.getByRole('navigation').getByRole('link', { name: area }).click();
    await expect(page.getByRole('heading', { name: area, level: 1 })).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);

  // AC-8: no token the authorization server issued is anywhere a browser
  // keeps things: local and session storage, cookies, IndexedDB, the URL.
  const issued = await asTest<string[]>('/test/tokens');
  expect(issued.length).toBeGreaterThan(0);
  const kept = await page.evaluate(async () => {
    const dump = (s: Storage): string => Object.entries(s).flat().join('\n');
    const databases =
      'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name ?? '') : [];
    return [
      dump(localStorage),
      dump(sessionStorage),
      document.cookie,
      location.href,
      ...databases,
    ].join('\n');
  });
  for (const token of issued) expect(kept).not.toContain(token);

  // AC-12: every request went to the console itself, the authorization
  // server or the operator; nothing to a third party.
  const allowed = new Set([CONSOLE_ORIGIN, AS_ORIGIN, OPERATOR_ORIGIN]);
  const foreign = requests.map((r) => new URL(r.url()).origin).filter((o) => !allowed.has(o));
  expect(foreign).toEqual([]);
});

test('the operator holds the line on console tokens, as a browser sees it (AC-5, R7)', async ({
  page,
}) => {
  await page.goto('/');
  const mint = async (query: string): Promise<string> =>
    (await asTest<{ token: string }>(`/test/mint?${query}`)).token;
  const good = await mint('');
  const otherOperator = await mint(`aud=${encodeURIComponent('https://other.e2e.test/v1')}`);
  const narrow = await mint('scope=location.read');
  const stale = await mint(`auth_age=${String(STEP_UP_MAX_AGE_SECS + 60)}`);

  const results = await page.evaluate(
    async ({ origin, tokens }) => {
      const call = async (token: string, method: string, path: string) => {
        const response = await fetch(`${origin}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}` },
        });
        const text = await response.text();
        return {
          status: response.status,
          body: text,
          requestId: response.headers.get('x-request-id'),
        };
      };
      return {
        good: await call(tokens.good, 'GET', '/v1/admin/sub-users'),
        otherOperator: await call(tokens.otherOperator, 'GET', '/v1/admin/sub-users'),
        narrow: await call(tokens.narrow, 'GET', '/v1/admin/sub-users'),
        staleRead: await call(tokens.stale, 'GET', '/v1/admin/sub-users'),
        staleWrite: await call(
          tokens.stale,
          'DELETE',
          '/v1/admin/sub-users/00000000-0000-4000-8000-000000000000',
        ),
      };
    },
    { origin: OPERATOR_ORIGIN, tokens: { good, otherOperator, narrow, stale } },
  );

  expect(results.good.status).toBe(200);
  // The CORS layer exposes x-request-id to the page, so errors can quote it.
  expect(results.good.requestId).not.toBeNull();
  expect(results.otherOperator.status).toBe(401);
  expect(results.narrow.status).toBe(403);
  expect(results.narrow.body).toContain('insufficient_scope');
  // A stale sign-in still reads, and is refused a destructive write with
  // RFC 9470's code and the operator's window, in the body the page can read.
  expect(results.staleRead.status).toBe(200);
  expect(results.staleWrite.status).toBe(401);
  const body = JSON.parse(results.staleWrite.body) as { error: { code: string; max_age: number } };
  expect(body.error.code).toBe('insufficient_user_authentication');
  expect(body.error.max_age).toBe(STEP_UP_MAX_AGE_SECS);
});

test('a destructive write after the step-up window signs in again and then completes (FR-42)', async ({
  page,
  browserName,
}) => {
  const signedInAt = await signIn(page);
  const name = `E2E ${browserName} ${String(Date.now())}`;

  await page.getByRole('navigation').getByRole('link', { name: 'People' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText(`${name} was added.`)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();

  // Outwait the operator's step-up window.
  const wait = signedInAt + (STEP_UP_MAX_AGE_SECS + 2) * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);

  const before = (await asTest<unknown[]>('/test/log')).length;
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

  // The operator refused for an old sign-in; the console signed in again
  // with max_age (the authorization server consents at once), came back to
  // People and offers the action once more.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('You signed in again.')).toBeVisible();
  const log = await asTest<{ max_age: string | null }[]>('/test/log');
  expect(log.length).toBe(before + 1);
  expect(log.at(-1)?.max_age).toBe(String(STEP_UP_MAX_AGE_SECS));

  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(`${name} was removed.`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
});
