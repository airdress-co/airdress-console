// The step-up window arithmetic, on its own and with no imports, so the
// end-to-end suite (which does not resolve the app's `@/` paths) can use the
// same numbers the console does.

/**
 * The operator's step-up window for console tokens (D-9, FR-40): a
 * destructive write needs a sign-in no older than this. The operator is the
 * authority and says so in its challenge; this only lets the console warn
 * before the write rather than surprise after it.
 */
export const STEP_UP_WINDOW_SECONDS = 300;

/**
 * Seconds asked of the hub below the operator's window. The hub honours
 * `max_age` at authorize and the operator checks `auth_time` again at the
 * write, seconds later; asked for the same number, a sign-in near the edge
 * passed the hub silently and failed the operator, and the step-up bounced
 * without ever asking for the password (VM3, 2026-11-04).
 */
export const STEP_UP_MARGIN_SECONDS = 60;

/** The `max_age` to ask the hub for, given the operator's challenge. */
export function askedMaxAge(challenge: number): number {
  return Math.max(0, challenge - STEP_UP_MARGIN_SECONDS);
}

/** Whether a destructive write now will be sent to sign in again first. */
export function freshSignInLikely(
  signedInAt: number | undefined,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  return signedInAt !== undefined && nowSeconds - signedInAt > STEP_UP_WINDOW_SECONDS;
}
