import { describe, expect, it } from 'vitest';
import { HttpError } from '@/api/errors.ts';
import { operatorRequest } from '@/api/http.ts';
import { createSession } from '@/auth/session.ts';
import { createTokenVault } from '@/auth/vault.ts';
import { ACCESS, CONFIG, REFRESH, RESOURCE, fakeNetwork } from '@/test/fake-hub.ts';
import { createQueryClient, shouldRetryQuery } from './client.ts';
import { operatorKeys } from './keys.ts';

describe('retry rules', () => {
  it('retries a lost network and a 5xx, at most twice', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new HttpError(503, undefined, undefined, 'x'))).toBe(true);
    expect(shouldRetryQuery(2, new HttpError(503, undefined, undefined, 'x'))).toBe(false);
  });

  it('never retries a 4xx', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(shouldRetryQuery(0, new HttpError(status, 'code', undefined, 'x'))).toBe(false);
    }
  });

  it('never retries a mutation', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('the cache never holds a token', () => {
  it('keeps tokens out of every key and every cached value', async () => {
    const network = fakeNetwork({ machines: [{ id: 'm1', name: 'nas' }] });
    const queryClient = createQueryClient();
    const navigations: string[] = [];
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
    await session.signIn(RESOURCE, '/');
    const state = new URL(navigations[0] ?? '').searchParams.get('state') ?? '';
    await session.completeSignIn(new URL(`${CONFIG.redirectUri}?code=c&state=${state}`));

    await queryClient.query({
      queryKey: operatorKeys.area('op.example', 'machines'),
      queryFn: () => operatorRequest(session, network.fetch, 'op.example', '/v1/admin/machines'),
    });

    const operatorCall = network.calls.find(
      (call) => call.url === 'https://op.example/v1/admin/machines',
    );
    expect(operatorCall?.headers.get('authorization')).toBe(`Bearer ${ACCESS}`);
    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => [query.queryKey, query.state.data]),
    );
    expect(cached).toContain('nas');
    expect(cached).not.toContain(ACCESS);
    expect(cached).not.toContain(REFRESH);
  });

  it('roots every key at the operator FQDN', () => {
    expect(operatorKeys.area('a.example', 'machines')[1]).toBe('a.example');
    expect(operatorKeys.all('b.example')).toEqual(['op', 'b.example']);
  });
});
