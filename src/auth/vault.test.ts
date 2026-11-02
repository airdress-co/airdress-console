import { describe, expect, it, vi } from 'vitest';
import type { Clock } from './vault.ts';
import { REFRESH_LEAD_MS, createTokenVault } from './vault.ts';

function fakeClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  return {
    now: () => now,
    setTimeout: (run, ms) => {
      next += 1;
      timers.set(next, { at: now + ms, run });
      return next;
    },
    clearTimeout: (handle) => {
      if (typeof handle === 'number') timers.delete(handle);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
    },
  };
}

const response = {
  accessToken: 'access-1',
  expiresIn: 900,
  refreshToken: 'refresh-1',
  scope: 'operator.admin',
};

describe('token vault', () => {
  it('asks for a refresh one minute before expiry, once', () => {
    const clock = fakeClock();
    const vault = createTokenVault(clock);
    const due = vi.fn();
    vault.onRefreshDue(due);
    vault.hold(response, 'https://op.example/v1');
    clock.advance(900_000 - REFRESH_LEAD_MS - 1);
    expect(due).not.toHaveBeenCalled();
    clock.advance(1);
    expect(due).toHaveBeenCalledTimes(1);
    clock.advance(10 * 60_000);
    expect(due).toHaveBeenCalledTimes(1);
  });

  it('stops handing out an expired access token', () => {
    const clock = fakeClock();
    const vault = createTokenVault(clock);
    vault.hold(response, 'https://op.example/v1');
    expect(vault.accessToken()).toBe('access-1');
    clock.advance(900_000);
    expect(vault.accessToken()).toBeUndefined();
  });

  it('keeps the refresh token when a refresh returns none', () => {
    const vault = createTokenVault(fakeClock());
    vault.hold(response, 'https://op.example/v1');
    vault.hold(
      { ...response, accessToken: 'access-2', refreshToken: undefined },
      'https://op.example/v1',
    );
    expect(vault.refreshToken()).toBe('refresh-1');
    expect(vault.accessToken()).toBe('access-2');
  });

  it('forgets everything and cancels the timer', () => {
    const clock = fakeClock();
    const vault = createTokenVault(clock);
    const due = vi.fn();
    vault.onRefreshDue(due);
    vault.hold(response, 'https://op.example/v1');
    vault.forget();
    clock.advance(900_000);
    expect(due).not.toHaveBeenCalled();
    expect(vault.accessToken()).toBeUndefined();
    expect(vault.refreshToken()).toBeUndefined();
    expect(vault.resource()).toBeUndefined();
  });
});
