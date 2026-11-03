// The entry document's decisions, kept free of the DOM so they can be tested
// (SPEC-184 design §4). The entry is served at the site root and at
// /callback; every release lives under /v/<version>/ and is never replaced.

/** Channels a person can follow. `stable` is the default. */
export const CHANNELS = ['stable', 'next'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Where a person's channel choice is remembered. Not a secret. */
export const CHANNEL_KEY = 'airdress.console.channel';

/** A release version as it appears in /v/<version>/: semver, no `v`. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The OAuth `state` the app sends starts with the build's version and a
 * tilde (`0.1.0~<random>`), so the entry can hand the hub's answer back to
 * the build that asked. The random part is what the build checks; the
 * version only routes. Documented in CONTRIBUTING.md ("The callback
 * contract").
 */
export const STATE_SEPARATOR = '~';

export function isVersion(value: string): boolean {
  return VERSION.test(value);
}

export function isChannel(value: string | null): value is Channel {
  return value !== null && (CHANNELS as readonly string[]).includes(value);
}

/** The channel to load: an explicit `?channel=`, else the stored one, else stable. */
export function chooseChannel(query: string | null, stored: string | null): Channel {
  if (isChannel(query)) return query;
  if (isChannel(stored)) return stored;
  return 'stable';
}

/** `{"version":"0.1.0"}` → `0.1.0`; anything else → null. */
export function versionFromPointer(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('version' in body)) return null;
  const { version } = body;
  return typeof version === 'string' && isVersion(version) ? version : null;
}

export function buildPath(version: string): string {
  return `/v/${version}/`;
}

/**
 * The hub's answer at /callback, handed to the build named in `state`:
 * `/v/<version>/?oauth=callback&code=…&state=…`. Null when `state` names no
 * version, which the entry reports instead of guessing a build.
 */
export function callbackTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  const state = params.get('state') ?? '';
  const at = state.indexOf(STATE_SEPARATOR);
  if (at <= 0) return null;
  const version = state.slice(0, at);
  if (!isVersion(version)) return null;
  const forwarded = new URLSearchParams(params);
  forwarded.set('oauth', 'callback');
  return `${buildPath(version)}?${forwarded.toString()}`;
}
