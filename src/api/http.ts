import type { Session } from '@/auth/session.ts';
import { HttpError } from './errors.ts';

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

function errorCode(body: unknown): { code: string | undefined; message: string | undefined } {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return { code: undefined, message: undefined };
  }
  const error = body.error;
  if (typeof error === 'string') return { code: error, message: undefined };
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : undefined;
    return { code, message };
  }
  return { code: undefined, message: undefined };
}

async function toHttpError(response: Response): Promise<HttpError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const { code, message } = errorCode(body);
  return new HttpError(
    response.status,
    code,
    response.headers.get('x-request-id') ?? undefined,
    message ??
      `The operator answered ${String(response.status)}${code === undefined ? '' : ` ${code}`}`,
  );
}

/**
 * One request to the connected operator. The token is read from the session
 * at call time and placed in a header; it never enters a URL, a query key or
 * the cache. A 401 is answered by one refresh and one retry, no more.
 */
export async function operatorRequest(
  session: Session,
  fetchImpl: Fetch,
  fqdn: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const url = `https://${fqdn}${path}`;
  const send = async (token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('accept', 'application/json');
    return fetchImpl(url, { ...init, headers, credentials: 'omit', cache: 'no-store' });
  };

  const token = await session.bearer();
  if (token === undefined) throw new HttpError(401, 'not_signed_in', undefined, 'Not signed in.');
  let response = await send(token);
  if (response.status === 401 && (await session.refresh())) {
    const renewed = await session.bearer();
    if (renewed !== undefined) response = await send(renewed);
  }
  if (!response.ok) throw await toHttpError(response);
  if (response.status === 204) return undefined;
  return response.json();
}
