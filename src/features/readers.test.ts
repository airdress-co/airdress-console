import { describe, expect, it } from 'vitest';
import { UnexpectedResponseError } from '@/api/errors.ts';
import { readDevices } from './devices/api.ts';
import type { Resource } from './functions/api.ts';
import {
  containsRedaction,
  readLogs,
  readResources,
  readVersions,
  schedulesFiring,
  withEnabled,
} from './functions/api.ts';
import { readGrants } from './grants/api.ts';
import { proofOf, readMachines, readPendingMachines } from './machines/api.ts';
import { readCapabilities } from './overview/api.ts';
import { createBody, readSubUsers } from './people/api.ts';
import { readShellHosts } from './shells/api.ts';
import { readSubnameZone } from './subnames/api.ts';

// Payload shapes taken from airdress-operator v0.1.164's handlers.

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('expected an item');
  return item;
}

describe('area readers', () => {
  it('reads capabilities', () => {
    expect(
      readCapabilities({
        agent_bus: true,
        agent_devices: false,
        mcp_local: true,
        mcp_remote: false,
      }),
    ).toEqual({ agentBus: true, agentDevices: false, mcpLocal: true, mcpRemote: false });
  });

  it('reads sub-users (a bare list)', () => {
    expect(
      readSubUsers([
        { id: 'u1', display_name: 'Ana', created_at: '2026-11-01T00:00:00Z', last_used_at: null },
      ]),
    ).toEqual([
      { id: 'u1', displayName: 'Ana', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: undefined },
    ]);
  });

  it('reads devices from enrollments (what v0.1.164 sends), with the label from metadata', () => {
    expect(readDevices({ enrollments: [] })).toEqual([]);
    expect(readDevices({ items: [] })).toEqual([]);
    const [d] = readDevices({
      enrollments: [
        {
          id: 'e1',
          created_at: '2026-11-01T00:00:00Z',
          metadata: { device_label: 'Galaxy S23' },
          delegation_only: true,
        },
      ],
    });
    expect(d).toMatchObject({ id: 'e1', label: 'Galaxy S23', delegationOnly: true });
  });

  it('never reads the fingerprint or confirmation code of a waiting machine', () => {
    const [m] = readPendingMachines({
      enrollments: [
        {
          user_code: 'ABCD-EFGH',
          name: 'nas',
          fingerprint: 'SHA256:secret-to-compare',
          confirmation_code: '123456',
          kind: 'new',
          purpose: null,
          created_at: '2026-11-01T00:00:00Z',
          expires_at: '2026-11-01T00:10:00Z',
        },
      ],
    });
    expect(JSON.stringify(m)).not.toContain('secret-to-compare');
    expect(JSON.stringify(m)).not.toContain('123456');
  });

  it('reads machines with their authorization expiry', () => {
    const [m] = readMachines({
      machines: [
        {
          machine_id: 'm1',
          name: 'ci',
          approved_at: '2026-11-01T00:00:00Z',
          revoked_at: null,
          authorization: { expires_at: null, expiry: 'disabled' },
        },
      ],
    });
    expect(m).toMatchObject({ id: 'm1', authorizationExpiresAt: undefined });
  });

  it('reads the subname zone', () => {
    expect(
      readSubnameZone({
        zone: 'x.a.airdr.es',
        delegated: true,
        subnames: [
          {
            id: 's1',
            label: 'www',
            type: 'A',
            rdata: '192.0.2.1',
            ttl: 300,
            created_at: 't',
            created_by: 'o',
          },
        ],
      }).subnames[0],
    ).toMatchObject({ label: 'www', ttl: 300 });
  });

  it('reads shell hosts and grants', () => {
    expect(
      readShellHosts({
        hosts: [{ name: 'box', enabled: true, linked: true, connected: false }],
      })[0],
    ).toMatchObject({ name: 'box', connected: false });
    expect(
      readGrants({
        grants: [
          {
            id: 'g1',
            principal_id: 'u1',
            kind: 'Function',
            resource: null,
            actions: ['ReadStatus'],
            created_at: 't',
            created_by: 'client:airdress-console:sub',
          },
        ],
      })[0],
    ).toMatchObject({ resource: undefined, actions: ['ReadStatus'] });
  });

  it('fails loudly where a wrong shape enters', () => {
    expect(() => readGrants({ grants: [{ id: 1 }] })).toThrow(UnexpectedResponseError);
    expect(() => readSubUsers({ items: [] })).toThrow(UnexpectedResponseError);
  });
});

describe('functions', () => {
  const fn: Resource = first(
    readResources('/v1/kinds/Function', {
      kind: 'Function',
      items: [
        {
          apiVersion: 'airdress.co/v1alpha1',
          kind: 'Function',
          metadata: { name: 'relay', resourceVersion: '7', labels: { team: 'ops' }, generation: 3 },
          spec: { source: { version: 'abc' } },
          status: { conditions: [{ type: 'Ready', status: 'True', reason: 'Bound' }] },
        },
      ],
    }),
  );

  it('writes back what it read, one field changed, with the resourceVersion it read', () => {
    expect(withEnabled(fn, false)).toEqual({
      apiVersion: 'airdress.co/v1alpha1',
      kind: 'Function',
      metadata: { name: 'relay', resourceVersion: '7', labels: { team: 'ops' } },
      spec: { source: { version: 'abc' }, enabled: false },
    });
  });

  it('refuses to write back a spec with redacted fields', () => {
    const redacted: Resource = { ...fn, spec: { target: { redacted: true } } };
    expect(containsRedaction(redacted.spec)).toBe(true);
    expect(() => withEnabled(redacted, true)).toThrow(/redacted/);
  });

  it('finds the schedules that fire a function', () => {
    const schedules = readResources('/v1/kinds/Schedule', {
      kind: 'Schedule',
      items: [
        {
          apiVersion: 'a',
          kind: 'Schedule',
          metadata: { name: 'every-10s', resourceVersion: '1' },
          spec: { target: { kind: 'Function', name: 'relay' } },
          status: {},
        },
        {
          apiVersion: 'a',
          kind: 'Schedule',
          metadata: { name: 'other', resourceVersion: '1' },
          spec: { target: { kind: 'Function', name: 'x' } },
          status: {},
        },
      ],
    });
    expect(schedulesFiring(schedules, 'relay').map((s) => s.name)).toEqual(['every-10s']);
  });

  it('reads versions and logs', () => {
    const v = readVersions('/v1/functions/relay/versions', {
      name: 'relay',
      current: 'abc',
      deployments: [],
      versions: [{ version: 'abc', current: true, quarantined: false, signer: { machine: 'm1' } }],
    });
    expect(v.versions[0]).toMatchObject({ current: true, signerMachine: 'm1' });
    expect(
      readLogs('/v1/functions/relay/logs', {
        name: 'relay',
        lines: [
          {
            id: 1,
            at: 't',
            level: 'info',
            kind: 'log',
            body: { msg: 'hi' },
            invocation: 'i',
            version: null,
          },
        ],
      })[0],
    ).toMatchObject({ body: '{"msg":"hi"}' });
  });
});

describe('machine approval proof', () => {
  it('sends a fingerprint as a fingerprint and anything else as a confirmation code', () => {
    expect(proofOf(' SHA256:abc ')).toEqual({ kind: 'fingerprint', value: 'SHA256:abc' });
    expect(proofOf('123456')).toEqual({ kind: 'confirmation_code', value: '123456' });
  });
});

describe('adding a person, old and new operators', () => {
  it('sends only the name until the operator asks how they get an account', () => {
    expect(createBody('Dana')).toEqual({ display_name: 'Dana' });
  });

  // operator v0.1.166 with the person lane on: 422 account_choice_required
  it('sends exactly one of the two choices once asked', () => {
    expect(createBody('Dana', 'offer')).toEqual({ display_name: 'Dana', account_offer: true });
    expect(createBody('Dana', 'none')).toEqual({ display_name: 'Dana', without_account: true });
  });
});
