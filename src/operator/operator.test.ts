import { describe, expect, it } from 'vitest';
import { atLeast, requiredFor, supports } from '@/compat.ts';
import { ConnectRefusedError, checkOperator, fqdnOf } from './connection.ts';
import { PENDING_ACTION_KEY, savePendingAction, takePendingAction } from './step-up.ts';

const ISSUER = 'https://account.airdress.co';

function metadata(doc: unknown, status = 200) {
  return (): Promise<Response> => Promise.resolve(Response.json(doc, { status }));
}

describe('checkOperator (FR-17)', () => {
  const good = {
    resource: 'https://op.example/v1',
    authorization_servers: [ISSUER],
    scopes_supported: ['operator.admin', 'location.read'],
  };

  it('admits an operator that names this resource, the hub and the console scope', async () => {
    await expect(checkOperator(metadata(good), 'op.example', ISSUER)).resolves.toBeUndefined();
  });

  it.each([
    [{ ...good, authorization_servers: ['https://evil.example'] }, 'foreign_issuer'],
    [{ ...good, resource: 'https://other.example/v1' }, 'wrong_resource'],
    [{ ...good, scopes_supported: ['location.read'] }, 'no_console_scope'],
  ])('refuses %j as %s', async (doc, reason) => {
    await expect(checkOperator(metadata(doc), 'op.example', ISSUER)).rejects.toEqual(
      new ConnectRefusedError(reason as never),
    );
  });

  it('refuses an operator with no document (older than the console)', async () => {
    await expect(checkOperator(metadata({}, 404), 'op.example', ISSUER)).rejects.toEqual(
      new ConnectRefusedError('no_metadata'),
    );
  });

  it('says unreachable when no response arrives (network or CORS)', async () => {
    const fetch = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    await expect(checkOperator(fetch, 'op.example', ISSUER)).rejects.toEqual(
      new ConnectRefusedError('unreachable'),
    );
  });

  it('reads the operator back out of a resource', () => {
    expect(fqdnOf('https://qa-device.a.airdr.es/v1')).toBe('qa-device.a.airdr.es');
    expect(fqdnOf('https://x.example/v1/mcp')).toBeUndefined();
  });
});

describe('compat (FR-23)', () => {
  it('compares versions numerically', () => {
    expect(atLeast('v0.1.164', 'v0.1.164')).toBe(true);
    expect(atLeast('v0.1.99', 'v0.1.164')).toBe(false);
    expect(atLeast('0.2.0', 'v0.1.164')).toBe(true);
    expect(atLeast('v0.1.164-hotfix.1', 'v0.1.164')).toBe(true);
  });

  it('never asks for less than the console floor', () => {
    expect(requiredFor('devices')).toBe('v0.1.164');
    expect(supports('v0.1.163', 'devices')).toBe(false);
    expect(supports('v0.1.164', 'grants')).toBe(true);
    expect(supports(undefined, 'grants')).toBeUndefined();
    expect(supports('nightly', 'grants')).toBeUndefined();
  });
});

describe('pending action across a step-up (FR-42)', () => {
  it('is taken once, by its own area only', () => {
    const storage = window.sessionStorage;
    savePendingAction(storage, { area: 'devices', op: 'revoke', target: 'id-1', label: 'Pixel' });
    expect(takePendingAction(storage, 'people')).toBeUndefined();
    expect(takePendingAction(storage, 'devices')).toEqual({
      area: 'devices',
      op: 'revoke',
      target: 'id-1',
      label: 'Pixel',
    });
    expect(storage.getItem(PENDING_ACTION_KEY)).toBeNull();
  });

  it('holds only what it was, never what the person typed', () => {
    const storage = window.sessionStorage;
    savePendingAction(storage, {
      area: 'machines',
      op: 'approve',
      target: 'ABCD-EFGH',
      label: 'nas',
    });
    const raw = storage.getItem(PENDING_ACTION_KEY) ?? '';
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual([
      'area',
      'label',
      'op',
      'target',
    ]);
    storage.removeItem(PENDING_ACTION_KEY);
  });
});
