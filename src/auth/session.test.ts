import { afterEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '@/query/client.ts';
import { ACCESS, CONFIG, REFRESH, RESOURCE, fakeNetwork } from '@/test/fake-hub.ts';
import { PENDING_SIGN_IN_KEY } from './flow.ts';
import { createSession } from './session.ts';
import { createTokenVault } from './vault.ts';

function setup() {
  const network = fakeNetwork();
  const navigations: string[] = [];
  const queryClient = createQueryClient();
  const session = createSession({
    config: CONFIG,
    vault: createTokenVault(),
    queryClient,
    storage: window.sessionStorage,
    fetch: network.fetch,
    navigate: (url) => {
      navigations.push(url);
    },
  });
  return { session, network, navigations, queryClient };
}

async function signIn(): Promise<ReturnType<typeof setup> & { authorize: URL }> {
  const env = setup();
  await env.session.signIn(RESOURCE, '/machines');
  const [href] = env.navigations;
  if (href === undefined) throw new Error('no navigation');
  const authorize = new URL(href);
  const state = authorize.searchParams.get('state') ?? '';
  await env.session.completeSignIn(new URL(`${CONFIG.redirectUri}?code=the-code&state=${state}`));
  return { ...env, authorize };
}

/** AC-8: every place a browser could keep a token. */
function everywhereAToken(): string {
  const local = Object.entries(window.localStorage).flat().join('\n');
  const session = Object.entries(window.sessionStorage).flat().join('\n');
  return [local, session, document.cookie, window.location.href].join('\n');
}

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('sign-in', () => {
  it('asks the hub for its owned-resources grant with PKCE S256 and the console scope', async () => {
    const { session, navigations } = setup();
    await session.signIn(RESOURCE, '/');
    const [href] = navigations;
    expect(href).toBeDefined();
    const url = new URL(href ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://account.example/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'airdress-console',
      redirect_uri: 'https://console.example/callback',
      scope: 'operator.admin offline_access',
      code_challenge_method: 'S256',
    });
    // Naming a resource here narrows the grant to it, and switching
    // airdress afterwards is refused (see SignInRequest.resource).
    expect(url.searchParams.has('resource')).toBe(false);
    expect(url.searchParams.has('max_age')).toBe(false);
  });

  it('asks for a fresh sign-in on step-up', async () => {
    const { session, navigations } = setup();
    await session.signIn(RESOURCE, '/', 300);
    expect(new URL(navigations[0] ?? '').searchParams.get('max_age')).toBe('300');
  });

  it('redeems the code with the verifier and returns where it started', async () => {
    const { session, network, authorize } = await signIn();
    const redeem = network.calls.find((call) => call.url.endsWith('/oauth/token'));
    expect(redeem?.form?.get('grant_type')).toBe('authorization_code');
    expect(redeem?.form?.get('code')).toBe('the-code');
    expect(redeem?.form?.get('resource')).toBe(RESOURCE);
    expect(redeem?.form?.get('code_verifier')).toMatch(/^[\w-]{43}$/);
    expect(authorize.searchParams.get('code_challenge')).not.toBe(
      redeem?.form?.get('code_verifier'),
    );
    expect(session.signedIn.value).toBe(true);
    expect(session.resource.value).toBe(RESOURCE);
    await expect(session.bearer()).resolves.toBe(ACCESS);
  });

  it('keeps no token in storage, cookies or the address (AC-8)', async () => {
    await signIn();
    const seen = everywhereAToken();
    expect(seen).not.toContain(ACCESS);
    expect(seen).not.toContain(REFRESH);
    expect(window.sessionStorage.getItem(PENDING_SIGN_IN_KEY)).toBeNull();
  });

  it('holds only the verifier and state while the redirect is pending', async () => {
    const { session } = setup();
    await session.signIn(RESOURCE, '/');
    const pending: unknown = JSON.parse(
      window.sessionStorage.getItem(PENDING_SIGN_IN_KEY) ?? 'null',
    );
    expect(pending).toEqual({
      verifier: expect.any(String) as unknown,
      state: expect.any(String) as unknown,
      resource: RESOURCE,
      returnTo: '/',
    });
  });

  it('refuses an answer for another tab, and forgets the attempt', async () => {
    const { session } = setup();
    await session.signIn(RESOURCE, '/');
    await expect(
      session.completeSignIn(new URL(`${CONFIG.redirectUri}?code=x&state=not-mine`)),
    ).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(window.sessionStorage.getItem(PENDING_SIGN_IN_KEY)).toBeNull();
    expect(session.signedIn.value).toBe(false);
  });
});

describe('sign-out', () => {
  it('revokes the refresh token, forgets the tokens and empties the cache', async () => {
    const { session, network, queryClient } = await signIn();
    queryClient.setQueryData(['op', 'op.example', 'machines'], [{ id: 1 }]);
    await session.signOut();
    const revoke = network.calls.find((call) => call.url.endsWith('/oauth/revoke'));
    expect(revoke?.form?.get('token')).toBe(REFRESH);
    expect(revoke?.form?.get('token_type_hint')).toBe('refresh_token');
    expect(session.signedIn.value).toBe(false);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    await expect(session.bearer()).resolves.toBeUndefined();
  });
});
