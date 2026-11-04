import { describe, expect, it } from 'vitest';
import { authTimeOf } from '@/auth/session.ts';
import { STEP_UP_WINDOW_SECONDS, freshSignInLikely } from './step-up.ts';

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
