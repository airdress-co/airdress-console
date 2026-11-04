import { describe, expect, it } from 'vitest';
import { authTimeOf } from '@/auth/session.ts';
import { STEP_UP_WINDOW_SECONDS, askedMaxAge, freshSignInLikely, returnPath } from './step-up.ts';

const jwt = (claims: object): string =>
  [
    'x',
    btoa(JSON.stringify(claims)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    's',
  ].join('.');

describe('warning of a step-up before the write', () => {
  it('reads auth_time from the access token', () => {
    expect(authTimeOf(jwt({ sub: 'a', auth_time: 1_793_808_000 }))).toBe(1_793_808_000);
  });

  it('knows nothing from a token without the claim, or no token', () => {
    expect(authTimeOf(jwt({ sub: 'a' }))).toBeUndefined();
    expect(authTimeOf('not-a-jwt')).toBeUndefined();
    expect(authTimeOf(undefined)).toBeUndefined();
  });

  it('warns only once the sign-in is older than the window', () => {
    const now = 1_000_000;
    expect(freshSignInLikely(now - STEP_UP_WINDOW_SECONDS + 1, now)).toBe(false);
    expect(freshSignInLikely(now - STEP_UP_WINDOW_SECONDS - 1, now)).toBe(true);
    expect(freshSignInLikely(undefined, now)).toBe(false);
  });
});

describe('the step-up round trip', () => {
  // VM3, 2026-11-04: asked for the operator's own 300, a sign-in near the
  // edge passed the hub and failed the operator seconds later, and the
  // step-up bounced without asking for the password.
  it('asks the hub for less than the operator allows', () => {
    expect(askedMaxAge(300)).toBe(240);
    expect(askedMaxAge(30)).toBe(0);
  });

  it('comes back to the page the action started on', () => {
    expect(returnPath('functions', '#/functions/console-check')).toBe('/functions/console-check');
    expect(returnPath('functions', '#/functions')).toBe('/functions');
    expect(returnPath('machines', '#/machines?x=1')).toBe('/machines');
  });

  it('falls back to the area for anything outside it', () => {
    expect(returnPath('functions', '#/devices')).toBe('/functions');
    expect(returnPath('functions', '#/functionsx')).toBe('/functions');
    expect(returnPath('functions', '')).toBe('/functions');
  });
});
