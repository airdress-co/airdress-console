import type { TokenResponse } from './token-response.ts';

/** Renew this long before the access token expires (SPEC-184 design §5.3). */
export const REFRESH_LEAD_MS = 60_000;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

/**
 * Where the tokens live: in this closure and nowhere else (FR-13). Not
 * reactive, never written to storage, never handed to the query cache. A
 * reload forgets them, by design.
 */
export interface TokenVault {
  hold(response: TokenResponse, resource: string): void;
  /** The current access token, or undefined when signed out or expired. */
  accessToken(): string | undefined;
  refreshToken(): string | undefined;
  /** The resource the held tokens are for. */
  resource(): string | undefined;
  /** Called once, `REFRESH_LEAD_MS` before the access token expires. */
  onRefreshDue(handler: () => void): void;
  forget(): void;
}

interface Held {
  readonly access: string;
  readonly refresh: string | undefined;
  readonly resource: string;
  readonly expiresAt: number;
}

export function createTokenVault(clock: Clock = systemClock): TokenVault {
  let held: Held | undefined;
  let timer: unknown;
  let refreshDue: (() => void) | undefined;

  function cancelTimer(): void {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  }

  return {
    hold(response, resource) {
      cancelTimer();
      const expiresAt = clock.now() + response.expiresIn * 1000;
      held = {
        access: response.accessToken,
        // A refresh that returns no new refresh token keeps the old one.
        refresh: response.refreshToken ?? held?.refresh,
        resource,
        expiresAt,
      };
      const delay = Math.max(0, expiresAt - REFRESH_LEAD_MS - clock.now());
      timer = clock.setTimeout(() => {
        timer = undefined;
        refreshDue?.();
      }, delay);
    },
    accessToken() {
      if (held === undefined || clock.now() >= held.expiresAt) return undefined;
      return held.access;
    },
    refreshToken() {
      return held?.refresh;
    },
    resource() {
      return held?.resource;
    },
    onRefreshDue(handler) {
      refreshDue = handler;
    },
    forget() {
      cancelTimer();
      held = undefined;
    },
  };
}
