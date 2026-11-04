import {
  HttpError,
  StepUpRequiredError,
  UnexpectedResponseError,
  isNetworkFailure,
  isUnavailable,
} from './errors.ts';

/**
 * What a person is told about an error (design §9). A message key and its
 * values, plus what they can quote. Anything the console does not
 * recognise is shown as the operator said it, with the request id (FR-24).
 */
export interface ErrorDescription {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'not_owner',
  'not_enabled',
  'insufficient_scope',
  'confirmation_mismatch',
  'no_pending_enrollment',
  'enrollment_expired',
  'source_signing_kind_required',
  'source_base_stale',
  'already_granted',
  'principal_not_grantable',
  'principal_revoked',
  'not_delegated',
  'duplicate',
  'cname_conflict',
  'reserved_label',
  'wildcard_not_allowed',
  'configured_name',
  'invalid_subname',
  'invalid_grant',
]);

export function describeError(error: unknown): ErrorDescription {
  if (error instanceof StepUpRequiredError) {
    return { key: 'errors.stepUp', values: {}, code: error.code, requestId: error.requestId };
  }
  if (error instanceof HttpError) {
    if (isUnavailable(error)) {
      return {
        key: 'errors.unavailable',
        values: {},
        code: error.code,
        requestId: error.requestId,
      };
    }
    if (error.status === 401) {
      return { key: 'errors.signedOut', values: {}, code: error.code, requestId: error.requestId };
    }
    // AC-14: a stale promote names who deployed in between.
    if (error.code === 'source_base_stale' && error.changedBy !== undefined) {
      return {
        key: 'errors.staleBy',
        values: { who: error.changedBy },
        code: error.code,
        requestId: error.requestId,
      };
    }
    if (error.code !== undefined && KNOWN_CODES.has(error.code)) {
      return {
        key: `errors.codes.${error.code}`,
        values: {},
        code: error.code,
        requestId: error.requestId,
      };
    }
    return {
      key: 'errors.operator',
      values: { status: String(error.status), message: error.message },
      code: error.code,
      requestId: error.requestId,
    };
  }
  if (error instanceof UnexpectedResponseError) {
    return {
      key: 'errors.unexpected',
      values: { detail: error.detail },
      code: undefined,
      requestId: undefined,
    };
  }
  if (isNetworkFailure(error)) {
    return { key: 'errors.network', values: {}, code: undefined, requestId: undefined };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { key: 'errors.other', values: { message }, code: undefined, requestId: undefined };
}
