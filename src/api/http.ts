import type { Session } from '@/auth/session.ts';
import {
  DEFAULT_STEP_UP_MAX_AGE,
  HttpError,
  INSUFFICIENT_USER_AUTHENTICATION,
  StepUpRequiredError,
} from './errors.ts';

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface ErrorBody {
  readonly code: string | undefined;
  readonly message: string | undefined;
  readonly maxAge: number | undefined;
  /** `source_base_stale`: who published what runs now (`currentPublishedBy`). */
  readonly publishedBy?: string | undefined;
}

/**
 * The operator answers errors in two shapes: `{"error": {"code", "message"}}`
 * on most routes and `{"error": "<code>", "message"}` on a few (subnames,
 * promote). Both are read here, once.
 */
export function readErrorBody(body: unknown): ErrorBody {
  const none: ErrorBody = { code: undefined, message: undefined, maxAge: undefined };
  if (typeof body !== 'object' || body === null || !('error' in body)) return none;
  const error = body.error;
  if (typeof error === 'string') {
    const message =
      'message' in body && typeof body.message === 'string' ? body.message : undefined;
    const publishedBy =
      'currentPublishedBy' in body && typeof body.currentPublishedBy === 'string'
        ? body.currentPublishedBy
        : undefined;
    return { code: error, message, maxAge: undefined, publishedBy };
  }
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : undefined;
    const maxAge =
      'max_age' in error && typeof error.max_age === 'number' ? error.max_age : undefined;
    return { code, message, maxAge };
  }
  return none;
}

/**
 * RFC 9470 puts the step-up challenge in `WWW-Authenticate`. The operator
 * does not expose that header to CORS today (only `x-request-id`), so the
 * body is what the console reads; the header is a fallback for an operator
 * that does expose it.
 */
export function readChallenge(header: string | null): ErrorBody {
  const none: ErrorBody = { code: undefined, message: undefined, maxAge: undefined };
  if (header === null || !/^\s*Bearer\b/i.test(header)) return none;
  const error = /\berror="([^"]*)"/.exec(header)?.[1];
  const maxAge = /\bmax_age=("?)(\d+)\1/.exec(header)?.[2];
  const description = /\berror_description="([^"]*)"/.exec(header)?.[1];
  return {
    code: error,
    message: description,
    maxAge: maxAge === undefined ? undefined : Number(maxAge),
  };
}

async function errorBody(response: Response): Promise<ErrorBody> {
  let fromBody: ErrorBody;
  try {
    fromBody = readErrorBody(await response.json());
  } catch {
    fromBody = { code: undefined, message: undefined, maxAge: undefined };
  }
  if (fromBody.code !== undefined) return fromBody;
  return readChallenge(response.headers.get('www-authenticate'));
}

function toHttpError(response: Response, body: ErrorBody): HttpError {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (response.status === 401 && body.code === INSUFFICIENT_USER_AUTHENTICATION) {
    return new StepUpRequiredError(body.maxAge ?? DEFAULT_STEP_UP_MAX_AGE, requestId);
  }
  return new HttpError(
    response.status,
    body.code,
    requestId,
    body.message ??
      `The operator answered ${String(response.status)}${body.code === undefined ? '' : ` ${body.code}`}`,
    body.publishedBy,
  );
}

async function parseOk(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}

/**
 * One request to the connected operator. The token is read from the session
 * at call time and placed in a header; it never enters a URL, a query key or
 * the cache. A 401 is answered by one refresh and one retry, no more, except
 * a step-up refusal, which no refresh can satisfy (design §6.3).
 */
export async function operatorRequest(
  session: Session,
  fetchImpl: Fetch,
  origin: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const url = `${origin}${path}`;
  const send = async (token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return fetchImpl(url, { ...init, headers, credentials: 'omit', cache: 'no-store' });
  };

  const token = await session.bearer();
  if (token === undefined) throw new HttpError(401, 'not_signed_in', undefined, 'Not signed in.');
  let response = await send(token);
  if (response.status === 401) {
    const body = await errorBody(response.clone());
    if (body.code === INSUFFICIENT_USER_AUTHENTICATION) throw toHttpError(response, body);
    if (await session.refresh()) {
      const renewed = await session.bearer();
      if (renewed !== undefined) response = await send(renewed);
    }
  }
  if (!response.ok) throw toHttpError(response, await errorBody(response));
  return parseOk(response);
}

/** An unauthenticated read (discovery documents, the client config). */
export async function publicRequest(fetchImpl: Fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw toHttpError(response, await errorBody(response));
  return parseOk(response);
}
