import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl } from '@/auth/flow.ts';
import { CONFIG, RESOURCE } from '@/test/fake-hub.ts';
import { callbackTarget } from './route.ts';

// Both halves of the callback contract: the build puts its version in front
// of the OAuth state, and the entry at /callback routes the answer by it.
describe('the callback contract', () => {
  it("routes the hub's answer back to the build that asked", async () => {
    const authorize = new URL(
      await buildAuthorizeUrl(
        CONFIG,
        { resource: RESOURCE, returnTo: '/machines' },
        window.sessionStorage,
      ),
    );
    const state = authorize.searchParams.get('state') ?? '';
    expect(state.startsWith('0.1.0~')).toBe(true);

    const target = callbackTarget(`?code=the-code&state=${encodeURIComponent(state)}`);
    expect(target).not.toBeNull();
    const routed = new URL(target ?? '', 'https://console.airdress.co');
    expect(routed.pathname).toBe('/v/0.1.0/');
    expect(routed.searchParams.get('oauth')).toBe('callback');
    expect(routed.searchParams.get('state')).toBe(state);
    expect(routed.searchParams.get('code')).toBe('the-code');
  });
});
