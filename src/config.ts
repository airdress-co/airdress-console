/**
 * Where the console signs in. The hub's authorization server is the only
 * issuer the console trusts; an operator that names another one is refused
 * before any token is sent (SPEC-184 FR-17).
 */
export interface AuthConfig {
  /** The authorization server's issuer, without a trailing slash. */
  readonly issuer: string;
  readonly clientId: string;
  /** Exactly as registered at the hub: this origin's `/callback`. */
  readonly redirectUri: string;
  /** What the console's token is for. Step-up (R7) keys on it. */
  readonly scope: string;
}

export const CONSOLE_SCOPE = 'operator.admin';

const DEFAULT_ISSUER = 'https://account.airdress.co';
const DEFAULT_CLIENT_ID = 'airdress-console';

export function authConfig(origin: string, env: ImportMetaEnv): AuthConfig {
  const issuer = (env.VITE_AUTH_ISSUER ?? DEFAULT_ISSUER).replace(/\/+$/, '');
  return {
    issuer,
    clientId: env.VITE_AUTH_CLIENT_ID ?? DEFAULT_CLIENT_ID,
    redirectUri: new URL('/callback', origin).href,
    scope: `${CONSOLE_SCOPE} offline_access`,
  };
}

export interface AuthEndpoints {
  readonly authorize: string;
  readonly token: string;
  readonly revoke: string;
}

export function endpoints(config: AuthConfig): AuthEndpoints {
  return {
    authorize: `${config.issuer}/oauth/authorize`,
    token: `${config.issuer}/oauth/token`,
    revoke: `${config.issuer}/oauth/revoke`,
  };
}

/**
 * The hub's own API as an RFC 8707 resource. One console grant covers it and
 * every operator the person owns (the client has `owned_resources`), so the
 * console signs in for this, lists the person's airdresses, and re-scopes to
 * the chosen operator with a refresh (FR-16).
 */
export function hubApiResource(config: AuthConfig): string {
  return `${config.issuer}/api`;
}

/**
 * Where an operator's API is reached: `https://<fqdn>`. Only the end-to-end
 * harness overrides it (`VITE_E2E_OPERATOR_ORIGIN`, a build-time constant),
 * to reach its local operator; the resource identifier below never changes.
 */
export function operatorOrigin(fqdn: string, env: ImportMetaEnv = import.meta.env): string {
  return env.VITE_E2E_OPERATOR_ORIGIN ?? `https://${fqdn}`;
}

/** The RFC 8707 resource for an operator's API. */
export function operatorResource(fqdn: string): string {
  return `https://${fqdn}/v1`;
}
