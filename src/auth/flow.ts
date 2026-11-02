import type { AuthConfig } from '@/config.ts';
import { endpoints } from '@/config.ts';
import { challengeFor, randomToken } from './pkce.ts';
import type { TokenResponse } from './token-response.ts';
import { parseTokenResponse } from './token-response.ts';

/**
 * The only thing that crosses the redirect: the PKCE verifier, the state and
 * where to return. No token is ever written here; the entry is removed the
 * moment the callback reads it (SPEC-184 design §5.3, AC-8).
 */
export const PENDING_SIGN_IN_KEY = 'airdress.console.sign-in';

interface PendingSignIn {
  readonly verifier: string;
  readonly state: string;
  readonly resource: string;
  readonly returnTo: string;
}

export interface SignInRequest {
  /** The operator's `/v1` resource. */
  readonly resource: string;
  /** In-app location to come back to after the callback. */
  readonly returnTo: string;
  /** Step-up: ask for a sign-in no older than this many seconds (R7). */
  readonly maxAge?: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class SignInError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SignInError';
  }
}

export async function buildAuthorizeUrl(
  config: AuthConfig,
  request: SignInRequest,
  storage: Storage,
): Promise<string> {
  const pending: PendingSignIn = {
    verifier: randomToken(32),
    state: randomToken(16),
    resource: request.resource,
    returnTo: request.returnTo,
  };
  storage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify(pending));
  const url = new URL(endpoints(config).authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('resource', request.resource);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('code_challenge', await challengeFor(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (request.maxAge !== undefined) url.searchParams.set('max_age', String(request.maxAge));
  return url.href;
}

function readPending(storage: Storage): PendingSignIn {
  const raw = storage.getItem(PENDING_SIGN_IN_KEY);
  storage.removeItem(PENDING_SIGN_IN_KEY);
  if (raw === null) throw new SignInError('no_pending', 'No sign-in was started in this tab.');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('verifier' in parsed) ||
    !('state' in parsed) ||
    !('resource' in parsed) ||
    !('returnTo' in parsed) ||
    typeof parsed.verifier !== 'string' ||
    typeof parsed.state !== 'string' ||
    typeof parsed.resource !== 'string' ||
    typeof parsed.returnTo !== 'string'
  ) {
    throw new SignInError('no_pending', 'The pending sign-in could not be read.');
  }
  return {
    verifier: parsed.verifier,
    state: parsed.state,
    resource: parsed.resource,
    returnTo: parsed.returnTo,
  };
}

export interface CompletedSignIn {
  readonly tokens: TokenResponse;
  readonly resource: string;
  readonly returnTo: string;
}

async function postForm(
  fetchImpl: FetchLike,
  url: string,
  form: Record<string, string>,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    credentials: 'omit',
    cache: 'no-store',
  });
}

async function tokenError(response: Response): Promise<SignInError> {
  let code = `http_${String(response.status)}`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      code = body.error;
    }
  } catch {
    // Not JSON: the status is all there is.
  }
  return new SignInError(code, `The authorization server refused: ${code}`);
}

/** Finish a sign-in at `/callback`: check the state, redeem the code. */
export async function completeSignIn(
  config: AuthConfig,
  callback: URL,
  storage: Storage,
  fetchImpl: FetchLike,
): Promise<CompletedSignIn> {
  const pending = readPending(storage);
  const error = callback.searchParams.get('error');
  if (error !== null) throw new SignInError(error, `Sign-in did not complete: ${error}`);
  if (callback.searchParams.get('state') !== pending.state) {
    throw new SignInError('state_mismatch', 'The sign-in answer does not belong to this tab.');
  }
  const code = callback.searchParams.get('code');
  if (code === null || code === '')
    throw new SignInError('no_code', 'The sign-in answer has no code.');
  const response = await postForm(fetchImpl, endpoints(config).token, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: pending.verifier,
    resource: pending.resource,
  });
  if (!response.ok) throw await tokenError(response);
  return {
    tokens: parseTokenResponse(await response.json()),
    resource: pending.resource,
    returnTo: pending.returnTo,
  };
}

export async function refreshTokens(
  config: AuthConfig,
  refreshToken: string,
  resource: string,
  fetchImpl: FetchLike,
): Promise<TokenResponse> {
  const response = await postForm(fetchImpl, endpoints(config).token, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    resource,
  });
  if (!response.ok) throw await tokenError(response);
  return parseTokenResponse(await response.json());
}

/** RFC 7009. A failure is not an error the person can act on; it is logged by the caller. */
export async function revokeRefreshToken(
  config: AuthConfig,
  refreshToken: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  const response = await postForm(fetchImpl, endpoints(config).revoke, {
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: config.clientId,
  });
  return response.ok;
}
