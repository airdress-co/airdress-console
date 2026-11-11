import { afterEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '@/query/client.ts';
import { ACCESS, CONFIG, REFRESH, RESOURCE, fakeNetwork } from '@/test/fake-hub.ts';
import {
  RESUME_ATTEMPT_KEY,
  RESUME_KEY,
  RESUME_RETRY_MS,
  SHARED_RESUME_KEY,
  SHARED_RESUME_MAX_AGE_MS,
  createSession,
  resumeRoute,
} from './session.ts';
import { createTokenVault } from './vault.ts';

/**
 * One page load: a new session and an empty vault over the tab's
 * sessionStorage, which is what survives a reload or a switch to another
 * console version in the same tab.
 */
function load(clock: { t: number } = { t: 1_000_000 }) {
  const network = fakeNetwork();
  const navigations: string[] = [];
  const session = createSession({
    config: CONFIG,
    vault: createTokenVault(),
    queryClient: createQueryClient(),
    storage: window.sessionStorage,
    shared: window.localStorage,
    fetch: network.fetch,
    navigate: (url) => {
      navigations.push(url);
    },
    now: () => clock.t,
  });
  return { session, network, navigations };
}

/** A new tab of the same browser: its own sessionStorage is empty. */
function newTab(clock?: { t: number }): ReturnType<typeof load> {
  window.sessionStorage.clear();
  return load(clock);
}

async function answer(page: ReturnType<typeof load>): Promise<string> {
  const href = page.navigations.at(-1);
  if (href === undefined) throw new Error('no navigation');
  const state = new URL(href).searchParams.get('state') ?? '';
  return page.session.completeSignIn(new URL(`${CONFIG.redirectUri}?code=the-code&state=${state}`));
}

async function signedInPage(clock?: { t: number }): Promise<ReturnType<typeof load>> {
  const page = load(clock);
  await page.session.signIn(RESOURCE, '/overview');
  await answer(page);
  return page;
}

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('resuming after a reload', () => {
  it('has nothing to resume in a tab that never signed in', async () => {
    const page = load();
    await expect(page.session.resume('/network')).resolves.toBe(false);
    expect(page.navigations).toEqual([]);
  });

  it('signs in again for the operator this tab was on, and comes back to the route', async () => {
    await signedInPage();
    const reloaded = load();
    expect(reloaded.session.signedIn.value).toBe(false);
    await expect(reloaded.session.resume('/network')).resolves.toBe(true);

    const authorize = new URL(reloaded.navigations[0] ?? '');
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      'https://account.example/oauth/authorize',
    );
    // An ordinary sign-in: no max_age, so a step-up still asks for one of its own.
    expect(authorize.searchParams.has('max_age')).toBe(false);
    expect(authorize.searchParams.has('resource')).toBe(false);

    await expect(answer(reloaded)).resolves.toBe('/network');
    const redeem = reloaded.network.calls.find((c) => c.url.endsWith('/oauth/token'));
    expect(redeem?.form?.get('resource')).toBe(RESOURCE);
    expect(reloaded.session.resource.value).toBe(RESOURCE);
    await expect(reloaded.session.bearer()).resolves.toBe(ACCESS);
  });

  it('follows a switch to another resource', async () => {
    const page = await signedInPage();
    const other = 'https://other.example/v1';
    await page.session.switchTo(other);
    expect(window.sessionStorage.getItem(RESUME_KEY)).toBe(other);
  });

  it('keeps the resource only: no token anywhere a browser keeps things (AC-8)', async () => {
    await signedInPage();
    const dump = (s: Storage): string => Object.entries(s).flat().join('\n');
    const kept = [dump(window.sessionStorage), dump(window.localStorage), document.cookie].join(
      '\n',
    );
    expect(kept).not.toContain(ACCESS);
    expect(kept).not.toContain(REFRESH);
    expect(window.sessionStorage.getItem(RESUME_KEY)).toBe(RESOURCE);
  });

  it('does not loop when the hub cannot answer without the person', async () => {
    const clock = { t: 5_000_000 };
    await signedInPage(clock);
    await expect(load(clock).session.resume('/overview')).resolves.toBe(true);
    // The sign-in did not come back with a session: the next load stays put.
    clock.t += RESUME_RETRY_MS - 1;
    const again = load(clock);
    await expect(again.session.resume('/overview')).resolves.toBe(false);
    expect(again.navigations).toEqual([]);
    clock.t += 1;
    await expect(load(clock).session.resume('/overview')).resolves.toBe(true);
  });

  it('a completed sign-in clears the attempt', async () => {
    const clock = { t: 5_000_000 };
    await signedInPage(clock);
    const reloaded = load(clock);
    await reloaded.session.resume('/overview');
    await answer(reloaded);
    expect(window.sessionStorage.getItem(RESUME_ATTEMPT_KEY)).toBeNull();
  });

  it('does nothing while a session is held', async () => {
    const page = await signedInPage();
    const before = page.navigations.length;
    await expect(page.session.resume('/overview')).resolves.toBe(false);
    expect(page.navigations.length).toBe(before);
  });

  it('ends with sign-out: the next load shows the sign-in page', async () => {
    const page = await signedInPage();
    await page.session.signOut();
    expect(window.sessionStorage.getItem(RESUME_KEY)).toBeNull();
    await expect(load().session.resume('/overview')).resolves.toBe(false);
  });
});

describe('a new tab of a signed-in browser', () => {
  it('signs in by itself for the operator the browser was last on', async () => {
    const clock = { t: 5_000_000 };
    await signedInPage(clock);
    const tab = newTab(clock);
    await expect(tab.session.resume('/overview')).resolves.toBe(true);
    await expect(answer(tab)).resolves.toBe('/overview');
    const redeem = tab.network.calls.find((c) => c.url.endsWith('/oauth/token'));
    expect(redeem?.form?.get('resource')).toBe(RESOURCE);
  });

  it('follows the last switch in any tab', async () => {
    const page = await signedInPage();
    await page.session.switchTo('https://other.example/v1');
    const tab = newTab();
    await tab.session.resume('/overview');
    await answer(tab);
    expect(tab.session.resource.value).toBe('https://other.example/v1');
  });

  it('starts at sign-in once the hub session would have ended', async () => {
    const clock = { t: 5_000_000 };
    await signedInPage(clock);
    clock.t += SHARED_RESUME_MAX_AGE_MS;
    const tab = newTab(clock);
    await expect(tab.session.resume('/overview')).resolves.toBe(false);
    expect(tab.navigations).toEqual([]);
  });

  it('keeps the resource and a time only, never a token', async () => {
    await signedInPage();
    const raw = window.localStorage.getItem(SHARED_RESUME_KEY) ?? '';
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(['at', 'resource']);
    expect(raw).not.toContain(ACCESS);
    expect(raw).not.toContain(REFRESH);
  });

  it('ignores a hint it cannot read', async () => {
    for (const bad of ['nonsense', '{}', '{"resource":"","at":1}', '{"resource":"x"}']) {
      window.localStorage.setItem(SHARED_RESUME_KEY, bad);
      await expect(newTab().session.resume('/overview')).resolves.toBe(false);
    }
  });

  it('ends with sign-out in any tab', async () => {
    const page = await signedInPage();
    await page.session.signOut();
    expect(window.localStorage.getItem(SHARED_RESUME_KEY)).toBeNull();
    await expect(newTab().session.resume('/overview')).resolves.toBe(false);
  });
});

describe('resumeRoute', () => {
  it('comes back to the route in the address bar', () => {
    expect(resumeRoute('#/network')).toBe('/network');
    expect(resumeRoute('#/machines?x=1')).toBe('/machines?x=1');
  });

  it('goes on from the connect page, which the router then sends where it belongs', () => {
    expect(resumeRoute('')).toBe('/overview');
    expect(resumeRoute('#/')).toBe('/overview');
    expect(resumeRoute('#nonsense')).toBe('/overview');
  });
});

describe('signing out of every tab', () => {
  /** Two tabs on one channel; a BroadcastChannel never hears its own posts. */
  function pair() {
    const listeners: (() => void)[] = [];
    const sent: unknown[] = [];
    const tab = (index: number) => ({
      postMessage: (message: unknown) => {
        sent.push(message);
        listeners.forEach((listener, i) => {
          if (i !== index) listener();
        });
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners[index] = listener;
      },
    });
    return { tab, sent };
  }

  it('tells the other tabs, which forget their tokens and revoke their own grant', async () => {
    const { tab, sent } = pair();
    const make = (index: number) => {
      const network = fakeNetwork();
      const navigations: string[] = [];
      const session = createSession({
        config: CONFIG,
        vault: createTokenVault(),
        queryClient: createQueryClient(),
        storage: window.sessionStorage,
        fetch: network.fetch,
        navigate: (url) => {
          navigations.push(url);
        },
        tabs: tab(index) as unknown as Pick<BroadcastChannel, 'postMessage' | 'addEventListener'>,
      });
      return { session, network, navigations };
    };
    const one = make(0);
    const two = make(1);
    for (const t of [one, two]) {
      await t.session.signIn(RESOURCE, '/overview');
      await answer(t);
    }
    expect(two.session.signedIn.value).toBe(true);

    await one.session.signOut();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['signed-out']);
    expect(two.session.signedIn.value).toBe(false);
    await expect(two.session.bearer()).resolves.toBeUndefined();
    expect(two.network.calls.some((c) => c.url.endsWith('/oauth/revoke'))).toBe(true);
  });
});
