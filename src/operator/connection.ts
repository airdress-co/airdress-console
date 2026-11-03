import type { Fetch } from '@/api/http.ts';
import { publicRequest } from '@/api/http.ts';
import { HttpError, isNetworkFailure } from '@/api/errors.ts';
import { isRecord } from '@/api/guards.ts';
import { CONSOLE_SCOPE, operatorOrigin, operatorResource } from '@/config.ts';

/** The operator a resource names: `https://<fqdn>/v1` → `<fqdn>`. */
export function fqdnOf(resource: string | undefined): string | undefined {
  if (resource === undefined) return undefined;
  const match = /^https:\/\/([^/]+)\/v1$/.exec(resource);
  return match?.[1];
}

export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/v1';

/** Why an operator cannot be connected to, in the words the UI shows. */
export type ConnectRefusal =
  'unreachable' | 'no_metadata' | 'foreign_issuer' | 'wrong_resource' | 'no_console_scope';

export class ConnectRefusedError extends Error {
  constructor(readonly reason: ConnectRefusal) {
    super(`Cannot connect: ${reason}`);
    this.name = 'ConnectRefusedError';
  }
}

/**
 * FR-17: before any token goes to an operator given by address, its RFC 9728
 * document for `/v1` must name exactly this resource and the hub as its
 * authorization server, and list the console's scope. An operator older
 * than the console's routes publishes no document (`no_metadata`).
 */
export async function checkOperator(fetchImpl: Fetch, fqdn: string, issuer: string): Promise<void> {
  let doc: unknown;
  try {
    doc = await publicRequest(fetchImpl, `${operatorOrigin(fqdn)}${RESOURCE_METADATA_PATH}`);
  } catch (error: unknown) {
    if (error instanceof HttpError) throw new ConnectRefusedError('no_metadata');
    if (isNetworkFailure(error)) throw new ConnectRefusedError('unreachable');
    throw error;
  }
  if (!isRecord(doc)) throw new ConnectRefusedError('no_metadata');
  const servers = doc['authorization_servers'];
  const scopes = doc['scopes_supported'];
  if (doc['resource'] !== operatorResource(fqdn)) throw new ConnectRefusedError('wrong_resource');
  if (!Array.isArray(servers) || !servers.includes(issuer)) {
    throw new ConnectRefusedError('foreign_issuer');
  }
  if (!Array.isArray(scopes) || !scopes.includes(CONSOLE_SCOPE)) {
    throw new ConnectRefusedError('no_console_scope');
  }
}
