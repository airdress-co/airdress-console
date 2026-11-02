/** The token endpoint's answer, checked where it enters (design §3.3). */
export interface TokenResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string | undefined;
  readonly scope: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTokenResponse(body: unknown): TokenResponse {
  if (!isRecord(body)) throw new Error('token response is not an object');
  const access = body['access_token'];
  const type = body['token_type'];
  const expires = body['expires_in'];
  const refresh = body['refresh_token'];
  const scope = body['scope'];
  if (typeof access !== 'string' || access === '')
    throw new Error('token response has no access_token');
  if (typeof type !== 'string' || type.toLowerCase() !== 'bearer') {
    throw new Error('token response is not a bearer token');
  }
  if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) {
    throw new Error('token response has no usable expires_in');
  }
  if (refresh !== undefined && typeof refresh !== 'string')
    throw new Error('refresh_token is not a string');
  if (scope !== undefined && typeof scope !== 'string') throw new Error('scope is not a string');
  return { accessToken: access, expiresIn: expires, refreshToken: refresh, scope };
}
