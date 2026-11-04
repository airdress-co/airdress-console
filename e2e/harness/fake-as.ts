// A stand-in for the hub's OAuth 2.1 authorization server, for the
// end-to-end harness only (SPEC-184 184-D.13). It mints what the real one
// mints for the console and nothing else:
//
// - RFC 8414 metadata and an Ed25519 JWKS, which the operator reads;
// - /oauth/authorize, which consents at once (no person here) and records
//   the max_age a step-up asked for;
// - /oauth/token with authorization_code and a ROTATING refresh_token, which
//   re-scopes within the grant, keeping auth_time. As the hub does
//   (resolve_resources, select_resource): an authorize request that names a
//   resource is a grant for exactly that one; naming none is the console's
//   registered "every operator I own plus the hub API";
// - /oauth/revoke and GET /api/airdresses (the hub-API read the console
//   lists airdresses with).
//
// Tokens carry exactly the claims of airdress-operator's
// tests/common/hub_as.rs: typ at+jwt, EdDSA, iss, sub, aud, client_id,
// scope, grant_id, jti, iat, exp = iat + 900, plus auth_time.
//
// Test control, answered without CORS headers so no page can read it:
// GET /test/log (the authorize requests seen, so a test can see a step-up
// asked for max_age), GET /test/tokens (every access and refresh token
// issued, so a test can search browser storage for them) and GET /test/mint
// (a token with chosen claims, for the operator's own token checks). A stale
// sign-in comes from the operator's short step-up window and the clock, not
// from backdating tokens here.
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface FakeAsOptions {
  readonly port: number;
  /** The console's origin: the only one CORS admits. */
  readonly consoleOrigin: string;
  /** The operator's airdress (its FQDN). */
  readonly operatorFqdn: string;
  /** The owner's subject; the operator's `[auth] owner_sub`. */
  readonly ownerSub: string;
}

export interface FakeAs {
  readonly issuer: string;
  readonly close: () => Promise<void>;
}

interface Family {
  refresh: string;
  authTime: number;
  readonly grantId: string;
  /** The one resource the authorize request named, or every owned one. */
  readonly resources: 'owned' | readonly string[];
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

function jwk(key: KeyObject, kid: string): Record<string, string> {
  const x = key.export({ format: 'jwk' }).x ?? '';
  return { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid, x };
}

function signJwt(privateKey: KeyObject, kid: string, claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'at+jwt', kid }));
  const body = b64url(JSON.stringify(claims));
  const signature = sign(null, Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${b64url(signature)}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeAs(opts: FakeAsOptions): Promise<FakeAs> {
  const issuer = `http://127.0.0.1:${String(opts.port)}`;
  const hubApi = `${issuer}/api`;
  const operatorResource = `https://${opts.operatorFqdn}/v1`;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const legacy = generateKeyPairSync('ed25519');
  const kid = 'as-e2e';
  const codes = new Map<string, { authTime: number; family: Family }>();
  const families = new Map<string, Family>();
  const authorizeLog: Record<string, string | null>[] = [];
  const issued: string[] = [];

  const mint = (family: Family, resource: string): Record<string, unknown> => {
    const now = Math.floor(Date.now() / 1000);
    const scope = resource === operatorResource ? 'operator.admin' : '';
    const token = signJwt(privateKey, kid, {
      iss: issuer,
      sub: opts.ownerSub,
      aud: resource,
      client_id: 'airdress-console',
      scope,
      grant_id: family.grantId,
      jti: randomUUID(),
      iat: now,
      exp: now + 900,
      auth_time: family.authTime,
    });
    family.refresh = `rt-${randomUUID()}`;
    families.set(family.refresh, family);
    issued.push(token, family.refresh);
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: family.refresh,
      scope,
    };
  };

  const owned = (resource: string): boolean => resource === hubApi || resource === operatorResource;
  // The hub's select_resource: the one asked, else the grant's first or the
  // hub API, and refused unless the grant holds it.
  const select = (family: Family, asked: string | null): string | undefined => {
    const wanted =
      asked ?? (family.resources === 'owned' ? hubApi : (family.resources[0] ?? hubApi));
    const inGrant =
      family.resources === 'owned' ? owned(wanted) : family.resources.includes(wanted);
    return inGrant ? wanted : undefined;
  };

  const send = (
    res: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ): true => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
    return true;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', issuer);
      const origin = req.headers.origin;
      if (origin === opts.consoleOrigin && !url.pathname.startsWith('/test/')) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('access-control-allow-methods', 'GET, POST');
        res.setHeader('access-control-allow-headers', 'authorization, content-type');
        res.setHeader('vary', 'origin');
      }
      if (req.method === 'OPTIONS') return send(res, 204);

      switch (`${req.method ?? ''} ${url.pathname}`) {
        case 'GET /.well-known/oauth-authorization-server':
          return send(res, 200, { issuer, jwks_uri: `${issuer}/oauth/jwks.json` });
        case 'GET /oauth/jwks.json':
          return send(res, 200, { keys: [jwk(publicKey, kid)] });
        case 'GET /legacy/jwks.json':
          return send(res, 200, { keys: [jwk(legacy.publicKey, 'legacy-e2e')] });

        case 'GET /oauth/authorize': {
          const q = url.searchParams;
          authorizeLog.push({
            resource: q.get('resource'),
            max_age: q.get('max_age'),
            scope: q.get('scope'),
            code_challenge_method: q.get('code_challenge_method'),
          });
          const resource = q.get('resource');
          const redirect = new URL(q.get('redirect_uri') ?? '');
          if (resource !== null && !owned(resource)) {
            redirect.searchParams.set('error', 'invalid_target');
          } else {
            // A fresh interactive sign-in: auth_time is now.
            const family: Family = {
              refresh: '',
              authTime: Math.floor(Date.now() / 1000),
              grantId: randomUUID(),
              resources: resource === null ? 'owned' : [resource],
            };
            const code = `code-${randomUUID()}`;
            codes.set(code, { authTime: family.authTime, family });
            redirect.searchParams.set('code', code);
          }
          redirect.searchParams.set('state', q.get('state') ?? '');
          res.writeHead(302, { location: redirect.href });
          res.end();
          return true;
        }

        case 'POST /oauth/token': {
          const form = new URLSearchParams(await readBody(req));
          if (form.get('grant_type') === 'authorization_code') {
            const entry = codes.get(form.get('code') ?? '');
            codes.delete(form.get('code') ?? '');
            if (entry === undefined) return send(res, 400, { error: 'invalid_grant' });
            const resource = select(entry.family, form.get('resource'));
            if (resource === undefined) return send(res, 400, { error: 'invalid_target' });
            return send(res, 200, mint(entry.family, resource));
          }
          if (form.get('grant_type') === 'refresh_token') {
            const family = families.get(form.get('refresh_token') ?? '');
            // Rotation: a spent refresh token is refused, as the hub does.
            if (family?.refresh !== form.get('refresh_token')) {
              return send(res, 400, { error: 'invalid_grant' });
            }
            const resource = select(family, form.get('resource'));
            if (resource === undefined) return send(res, 400, { error: 'invalid_target' });
            families.delete(family.refresh);
            return send(res, 200, mint(family, resource));
          }
          return send(res, 400, { error: 'unsupported_grant_type' });
        }

        case 'POST /oauth/revoke':
          await readBody(req);
          return send(res, 200);

        case 'GET /api/airdresses': {
          const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
          const payload = bearer.split('.')[1] ?? '';
          let aud: unknown;
          try {
            aud = (
              JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { aud?: unknown }
            ).aud;
          } catch {
            aud = undefined;
          }
          if (aud !== hubApi) return send(res, 401, { error: 'invalid_token' });
          return send(res, 200, {
            items: [
              {
                id: 'a-e2e',
                name: opts.operatorFqdn.split('.')[0],
                fqdn: opts.operatorFqdn,
                ipv4_address: '127.0.0.1',
                status: 'active',
                created_at: new Date().toISOString(),
              },
            ],
            next_cursor: null,
          });
        }

        case 'GET /test/log':
          return send(res, 200, authorizeLog);
        case 'GET /test/tokens':
          return send(res, 200, issued);
        case 'GET /test/mint': {
          const q = url.searchParams;
          const now = Math.floor(Date.now() / 1000);
          return send(res, 200, {
            token: signJwt(privateKey, kid, {
              iss: issuer,
              sub: opts.ownerSub,
              aud: q.get('aud') ?? operatorResource,
              client_id: 'airdress-console',
              scope: q.get('scope') ?? 'operator.admin',
              grant_id: randomUUID(),
              jti: randomUUID(),
              iat: now,
              exp: now + 900,
              auth_time: now - Number(q.get('auth_age') ?? '0'),
            }),
          });
        }
        default:
          return send(res, 404, { error: 'not_found' });
      }
    })().catch((error: unknown) => {
      send(res, 500, { error: String(error) });
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
  return {
    issuer,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
