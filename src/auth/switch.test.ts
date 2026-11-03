import { describe, expect, it } from 'vitest';
import { readOwnedPage } from '@/features/choose/api.ts';
import { createQueryClient } from '@/query/client.ts';
import { sessionTarget } from '@/router.ts';
import { CONFIG } from '@/test/fake-hub.ts';
import { createSession } from './session.ts';
import { createTokenVault } from './vault.ts';

const HUB_API = `${CONFIG.issuer}/api`;
const OP = 'https://op.example/v1';

/** A hub that rotates refresh tokens and refuses a spent one, as the real one does. */
function rotatingHub(refuse?: { resource: string; error: string }) {
  let live = 'rt-0';
  let n = 0;
  const redeemed: { token: string; resource: string }[] = [];
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    if (input !== `${CONFIG.issuer}/oauth/token`) return Response.json({});
    // Let concurrent callers interleave if the session failed to serialize.
    await new Promise((r) => setTimeout(r, 1));
    const token = form.get('refresh_token') ?? form.get('code') ?? '';
    const resource = form.get('resource') ?? '';
    redeemed.push({ token, resource });
    if (form.get('grant_type') === 'refresh_token' && token !== live) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (resource === refuse?.resource) {
      return Response.json({ error: refuse.error }, { status: 400 });
    }
    n += 1;
    live = `rt-${String(n)}`;
    return Response.json({
      access_token: `at-${String(n)}`,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: live,
    });
  };
  return { fetch, redeemed };
}

async function signedIn(hub: ReturnType<typeof rotatingHub>) {
  const queryClient = createQueryClient();
  const navigations: string[] = [];
  const session = createSession({
    config: CONFIG,
    vault: createTokenVault(),
    queryClient,
    storage: window.sessionStorage,
    fetch: hub.fetch,
    navigate: (url) => navigations.push(url),
  });
  await session.signIn(HUB_API, '/choose');
  const state = new URL(navigations[0] ?? '').searchParams.get('state') ?? '';
  await session.completeSignIn(new URL(`${CONFIG.redirectUri}?code=c&state=${state}`));
  return { session, queryClient };
}

describe('switching resource (FR-16)', () => {
  it('re-scopes to an operator with a refresh, and clears the cache', async () => {
    const hub = rotatingHub();
    const { session, queryClient } = await signedIn(hub);
    queryClient.setQueryData(['hub', 'airdresses'], ['x']);
    await session.switchTo(OP);
    expect(session.resource.value).toBe(OP);
    expect(queryClient.getQueryData(['hub', 'airdresses'])).toBeUndefined();
    expect(hub.redeemed.at(-1)).toEqual({ token: 'rt-1', resource: OP });
  });

  it('never redeems a refresh token twice when refreshes and switches race', async () => {
    const hub = rotatingHub();
    const { session } = await signedIn(hub);
    const results = await Promise.allSettled([
      session.refresh(),
      session.switchTo(OP),
      session.switchTo(HUB_API),
      session.refresh(),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const refreshTokens = hub.redeemed.filter((r) => r.token.startsWith('rt-')).map((r) => r.token);
    expect(new Set(refreshTokens).size).toBe(refreshTokens.length);
    expect(session.signedIn.value).toBe(true);
  });

  it('keeps the session when the hub refuses an operator the person does not own', async () => {
    const hub = rotatingHub({ resource: OP, error: 'invalid_target' });
    const { session } = await signedIn(hub);
    await expect(session.switchTo(OP)).rejects.toMatchObject({ code: 'invalid_target' });
    expect(session.signedIn.value).toBe(true);
    expect(session.resource.value).toBe(HUB_API);
  });

  it('ends the session when the grant is spent', async () => {
    const hub = rotatingHub({ resource: OP, error: 'invalid_grant' });
    const { session } = await signedIn(hub);
    await expect(session.switchTo(OP)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(session.signedIn.value).toBe(false);
  });
});

describe('the airdress list', () => {
  it('reads a page and its cursor', () => {
    expect(
      readOwnedPage({
        items: [
          {
            id: 'a1',
            name: 'qa-device',
            fqdn: 'qa-device.a.airdr.es',
            ipv4_address: '23.163.148.11',
            status: 'active',
            created_at: 't',
          },
        ],
        next_cursor: null,
      }),
    ).toEqual({
      items: [
        {
          id: 'a1',
          name: 'qa-device',
          fqdn: 'qa-device.a.airdr.es',
          label: undefined,
          status: 'active',
        },
      ],
      nextCursor: undefined,
    });
  });
});

describe('routing with a session', () => {
  it('sends a signed-in person with no operator to choose, and keeps connect open', () => {
    expect(sessionTarget('overview', false, false)).toEqual({ name: 'connect' });
    expect(sessionTarget('overview', true, false)).toEqual({ name: 'choose' });
    expect(sessionTarget('overview', true, true)).toBe(true);
    expect(sessionTarget('choose', true, false)).toBe(true);
    expect(sessionTarget('connect', true, true)).toBe(true);
  });
});
