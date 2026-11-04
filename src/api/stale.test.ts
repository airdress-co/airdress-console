import { describe, expect, it } from 'vitest';
import { describeError } from './describe.ts';
import { HttpError } from './errors.ts';
import { readErrorBody } from './http.ts';

describe('a stale promote names who deployed (AC-14)', () => {
  it('reads currentPublishedBy from the refusal', () => {
    expect(
      readErrorBody({
        error: 'source_base_stale',
        message: 'the function runs another version',
        currentPublishedBy: 'machine:e6a13993',
        current: 'sha256:aa',
      }),
    ).toMatchObject({ code: 'source_base_stale', publishedBy: 'machine:e6a13993' });
  });

  it('says who, and still the plain sentence when the operator does not', () => {
    const named = describeError(
      new HttpError(409, 'source_base_stale', 'r1', 'stale', 'machine:e6a13993'),
    );
    expect(named).toMatchObject({ key: 'errors.staleBy', values: { who: 'machine:e6a13993' } });
    const plain = describeError(new HttpError(409, 'source_base_stale', 'r1', 'stale'));
    expect(plain.key).toBe('errors.codes.source_base_stale');
  });
});
