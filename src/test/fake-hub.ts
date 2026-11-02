import type { AuthConfig } from '@/config.ts';

export const CONFIG: AuthConfig = {
  issuer: 'https://account.example',
  clientId: 'airdress-console',
  redirectUri: 'https://console.example/callback',
  scope: 'operator.admin offline_access',
};

export const ACCESS = 'at-SECRET-access-token-value';
export const REFRESH = 'rt-SECRET-refresh-token-value';
export const RESOURCE = 'https://op.example/v1';

export interface Recorded {
  readonly url: string;
  readonly form: URLSearchParams | undefined;
  readonly headers: Headers;
}

/** A hub token endpoint and an operator, in one fetch. */
export function fakeNetwork(operatorBody: unknown = { ok: true }): {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetch = (input: string, init: RequestInit): Promise<Response> => {
    const body = init.body;
    const form = typeof body === 'string' ? new URLSearchParams(body) : undefined;
    calls.push({ url: input, form, headers: new Headers(init.headers) });
    if (input === `${CONFIG.issuer}/oauth/token`) {
      return Promise.resolve(
        Response.json({
          access_token: ACCESS,
          token_type: 'Bearer',
          expires_in: 900,
          refresh_token: REFRESH,
          scope: 'operator.admin',
        }),
      );
    }
    if (input === `${CONFIG.issuer}/oauth/revoke`) {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return Promise.resolve(Response.json(operatorBody));
  };
  return { fetch, calls };
}
