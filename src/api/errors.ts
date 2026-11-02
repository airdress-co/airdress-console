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

/** fetch rejects with a TypeError when no response arrived (network, CORS). */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}
