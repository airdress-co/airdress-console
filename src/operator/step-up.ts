import { StepUpRequiredError } from '@/api/errors.ts';
import { useSession } from '@/auth/session.ts';
import type { Area } from '@/compat.ts';

/**
 * A destructive write the operator refused for an old sign-in (R7). The
 * sign-in it needs is a full-page redirect, so the action is kept across it
 * in sessionStorage: what it was, never a token and never a value the person
 * typed (a fingerprint, a confirmation code). After the redirect the area
 * shows the action again and the person confirms it (FR-42).
 */
export interface PendingAction {
  readonly area: Area;
  readonly op: string;
  readonly target: string;
  /** What the confirmation shows, e.g. the device's label. */
  readonly label: string;
}

export const PENDING_ACTION_KEY = 'airdress.console.pending-action';

/**
 * The operator's step-up window for console tokens (D-9, FR-40): a
 * destructive write needs a sign-in no older than this. The operator is the
 * authority and says so in its challenge; this only lets the console warn
 * before the write rather than surprise after it.
 */
export const STEP_UP_WINDOW_SECONDS = 300;

/** Whether a destructive write now will be sent to sign in again first. */
export function freshSignInLikely(
  signedInAt: number | undefined,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  return signedInAt !== undefined && nowSeconds - signedInAt > STEP_UP_WINDOW_SECONDS;
}

export function savePendingAction(storage: Storage, action: PendingAction): void {
  storage.setItem(PENDING_ACTION_KEY, JSON.stringify(action));
}

/** The pending action for this area, removed as it is read. */
export function takePendingAction(storage: Storage, area: Area): PendingAction | undefined {
  const raw = storage.getItem(PENDING_ACTION_KEY);
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(PENDING_ACTION_KEY);
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('area' in parsed) ||
    !('op' in parsed) ||
    !('target' in parsed) ||
    !('label' in parsed) ||
    parsed.area !== area ||
    typeof parsed.op !== 'string' ||
    typeof parsed.target !== 'string' ||
    typeof parsed.label !== 'string'
  ) {
    return undefined;
  }
  storage.removeItem(PENDING_ACTION_KEY);
  return { area, op: parsed.op, target: parsed.target, label: parsed.label };
}

export interface StepUp {
  /**
   * Run a destructive write. On a step-up refusal, keep the action and send
   * the person to a fresh sign-in; the promise then rejects with the
   * refusal so the caller stops.
   */
  run<T>(action: PendingAction, write: () => Promise<T>): Promise<T>;
  /** The action to offer again in this area, if one was kept. */
  resume(area: Area): PendingAction | undefined;
}

export function useStepUp(storage: Storage = window.sessionStorage): StepUp {
  const session = useSession();
  return {
    async run(action, write) {
      try {
        return await write();
      } catch (error: unknown) {
        const resource = session.resource.value;
        if (error instanceof StepUpRequiredError && resource !== undefined) {
          savePendingAction(storage, action);
          await session.signIn(resource, `/${action.area}`, error.maxAge);
        }
        throw error;
      }
    },
    resume: (area) => takePendingAction(storage, area),
  };
}
