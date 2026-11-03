/** An operator answered with an error status. Carries what a person can quote. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly requestId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * A destructive write was refused because the sign-in is older than the
 * operator allows for console tokens (SPEC-184 R7, RFC 9470). The console
 * answers with a fresh sign-in, never with a refresh: a refresh does not move
 * `auth_time`.
 */
export class StepUpRequiredError extends HttpError {
  constructor(
    readonly maxAge: number,
    requestId: string | undefined,
  ) {
    super(401, INSUFFICIENT_USER_AUTHENTICATION, requestId, 'This change needs a recent sign-in.');
    this.name = 'StepUpRequiredError';
  }
}

/** The RFC 9470 error code; the operator also puts it in the JSON body. */
export const INSUFFICIENT_USER_AUTHENTICATION = 'insufficient_user_authentication';

/** The step-up window the spec fixes when the operator does not say (R7). */
export const DEFAULT_STEP_UP_MAX_AGE = 300;

/** A response arrived but did not have the shape the console expects. */
export class UnexpectedResponseError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`Unexpected answer from ${path}: ${detail}`);
    this.name = 'UnexpectedResponseError';
  }
}

/** fetch rejects with a TypeError when no response arrived (network, CORS). */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/** A route this operator does not have (an older release). */
export function isUnavailable(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 404 || error.status === 405);
}
