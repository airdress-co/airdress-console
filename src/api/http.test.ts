import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/auth/session.ts';
import { HttpError, StepUpRequiredError } from './errors.ts';
import { operatorRequest, readErrorBody } from './http.ts';

function fakeSession(): Session & { refreshes: number } {
  const s = {
    refreshes: 0,
    signedIn: { value: true },
    resource: { value: 'https://op.example/v1' },
    signIn: vi.fn(),
    completeSignIn: vi.fn(),
    bearer: () => Promise.resolve('tok'),
    refresh: () => {
      s.refreshes += 1;
      return Promise.resolve(true);
    },
    signOut: vi.fn(),
  };
  return s as unknown as Session & { refreshes: number };
}

const respond =
  (...responses: Response[]) =>
  (): Promise<Response> => {
    const next = responses.shift();
    if (next === undefined) throw new Error('no more responses');
    return Promise.resolve(next);
  };

describe('readErrorBody', () => {
  it('reads the nested shape with max_age', () => {
    expect(
      readErrorBody({
        error: { code: 'insufficient_user_authentication', message: 'm', max_age: 300 },
      }),
    ).toEqual({ code: 'insufficient_user_authentication', message: 'm', maxAge: 300 });
  });

  it('reads the flat shape the subname and promote routes use', () => {
    expect(readErrorBody({ error: 'source_base_stale', message: 'who' })).toEqual({
      code: 'source_base_stale',
      message: 'who',
      maxAge: undefined,
    });
  });
});

describe('operatorRequest', () => {
  it('turns a step-up refusal into StepUpRequiredError without refreshing', async () => {
    const session = fakeSession();
    const fetch = respond(
      Response.json(
        { error: { code: 'insufficient_user_authentication', message: 'old', max_age: 120 } },
        { status: 401, headers: { 'x-request-id': 'r-1' } },
      ),
    );
    const error: unknown = await operatorRequest(session, fetch, 'op.example', '/v1/x', {
      method: 'DELETE',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepUpRequiredError);
    expect((error as StepUpRequiredError).maxAge).toBe(120);
    expect((error as StepUpRequiredError).requestId).toBe('r-1');
    // A refresh cannot move auth_time, so none is attempted.
    expect(session.refreshes).toBe(0);
  });

  it('refreshes once on a plain 401 and retries', async () => {
    const session = fakeSession();
    const fetch = respond(new Response(null, { status: 401 }), Response.json({ ok: true }));
    await expect(operatorRequest(session, fetch, 'op.example', '/v1/x')).resolves.toEqual({
      ok: true,
    });
    expect(session.refreshes).toBe(1);
  });

  it('returns undefined for 204 and an empty body', async () => {
    const fetch = respond(new Response(null, { status: 204 }));
    await expect(
      operatorRequest(fakeSession(), fetch, 'op.example', '/v1/x'),
    ).resolves.toBeUndefined();
  });

  it('carries the code and request id of a refusal', async () => {
    const fetch = respond(
      Response.json(
        { error: { code: 'not_owner', message: 'no' } },
        { status: 403, headers: { 'x-request-id': 'r-2' } },
      ),
    );
    const error: unknown = await operatorRequest(fakeSession(), fetch, 'op.example', '/v1/x').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 403, code: 'not_owner', requestId: 'r-2' });
  });
});
