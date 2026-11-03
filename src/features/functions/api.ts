import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';
import { computed, toValue } from 'vue';
import { HttpError } from '@/api/errors.ts';
import type { Json, Reader } from '@/api/guards.ts';
import { isRecord, Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';

/**
 * A resource as `/v1/kinds/{kind}` returns it. The console keeps the whole
 * manifest so an enable/disable writes back exactly what it read, changing
 * one field, with the `resourceVersion` it read (FR-35).
 */
export interface Resource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly resourceVersion: string;
  readonly labels: unknown;
  readonly spec: Json;
  readonly conditions: readonly Condition[];
}

export interface Condition {
  readonly type: string;
  readonly status: string;
  readonly reason: string | undefined;
  readonly message: string | undefined;
}

function readCondition(r: Reader): Condition {
  return {
    type: r.string('type'),
    status: r.string('status'),
    reason: r.optString('reason'),
    message: r.optString('message'),
  };
}

function readResource(r: Reader): Resource {
  const metadata = r.record('metadata');
  const spec = r.raw('spec');
  const status = r.optRecord('status');
  return {
    apiVersion: r.string('apiVersion'),
    kind: r.string('kind'),
    name: metadata.string('name'),
    resourceVersion: metadata.string('resourceVersion'),
    labels: metadata.raw('labels'),
    spec: isRecord(spec) ? spec : {},
    conditions:
      status?.raw('conditions') === undefined ? [] : status.list('conditions', readCondition),
  };
}

export const readResources = (path: string, body: unknown): readonly Resource[] =>
  R.of(path, body).list('items', readResource);

/**
 * An operator built without functions does not know the kind: `/v1/kinds/
 * Function` answers `400` with `unknown kind 'Function'`. That is "not on
 * this operator", not a refusal.
 */
export function isKindUnknown(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status === 400 &&
    (error.code ?? '').startsWith('unknown kind')
  );
}

/** `spec.enabled` defaults to true when absent (operator kinds). */
export function isEnabled(resource: Resource): boolean {
  return resource.spec['enabled'] !== false;
}

/** The Schedules that fire a function: `spec.target {kind: Function, name}`. */
export function schedulesFiring(schedules: readonly Resource[], fn: string): readonly Resource[] {
  return schedules.filter((s) => {
    const target = s.spec['target'];
    return isRecord(target) && target['kind'] === 'Function' && target['name'] === fn;
  });
}

function useKind(kind: 'Function' | 'Schedule', key: (fqdn: string) => readonly unknown[]) {
  const op = useOperator();
  const path = `/v1/kinds/${kind}`;
  return useQuery({
    queryKey: computed(() => key(op.fqdn.value ?? '')),
    queryFn: async () => readResources(path, await op.request(path)),
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export const useFunctions = (): ReturnType<typeof useKind> =>
  useKind('Function', operatorKeys.functions);
export const useSchedules = (): ReturnType<typeof useKind> =>
  useKind('Schedule', operatorKeys.schedules);

export interface FunctionVersion {
  readonly version: string;
  readonly publishedAt: string | undefined;
  readonly publishedBy: string | undefined;
  readonly current: boolean;
  readonly quarantined: boolean;
  readonly signerKey: string | undefined;
  readonly signerMachine: string | undefined;
}

export interface FunctionVersions {
  readonly current: string | undefined;
  readonly versions: readonly FunctionVersion[];
}

export function readVersions(path: string, body: unknown): FunctionVersions {
  const r = R.of(path, body);
  return {
    current: r.optString('current'),
    versions: r.list('versions', (v) => {
      const signer = v.optRecord('signer');
      return {
        version: v.string('version'),
        publishedAt: v.optString('publishedAt'),
        publishedBy: v.optString('publishedBy'),
        current: v.optBoolean('current') ?? false,
        quarantined: v.optBoolean('quarantined') ?? false,
        signerKey: signer?.optString('key'),
        signerMachine: signer?.optString('machine'),
      };
    }),
  };
}

export interface LogLine {
  readonly id: number;
  readonly at: string;
  readonly level: string;
  readonly version: string | undefined;
  readonly body: string;
}

export function readLogs(path: string, body: unknown): readonly LogLine[] {
  return R.of(path, body).list('lines', (l) => {
    const raw = l.raw('body');
    return {
      id: l.number('id'),
      at: l.string('at'),
      level: l.string('level'),
      version: l.optString('version'),
      body: typeof raw === 'string' ? raw : JSON.stringify(raw),
    };
  });
}

export function useFunctionVersions(
  name: MaybeRefOrGetter<string>,
): ReturnType<typeof useQuery<FunctionVersions>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.functionVersions(op.fqdn.value ?? '', toValue(name))),
    queryFn: async () => {
      const path = `/v1/functions/${encodeURIComponent(toValue(name))}/versions`;
      return readVersions(path, await op.request(path));
    },
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

export function useFunctionLogs(
  name: MaybeRefOrGetter<string>,
): ReturnType<typeof useQuery<readonly LogLine[]>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() => operatorKeys.functionLogs(op.fqdn.value ?? '', toValue(name))),
    queryFn: async () => {
      const path = `/v1/functions/${encodeURIComponent(toValue(name))}/logs`;
      return readLogs(path, await op.request(`${path}?limit=200`));
    },
    enabled: computed(() => op.fqdn.value !== undefined),
    // Logs poll while they are on screen (design §3.3).
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

/**
 * The operator replaces what a reader may not see with `{"redacted": true}`
 * (today: a person's event subscription). Writing such a spec back would
 * store the marker over the real value, so the console refuses to.
 */
export function containsRedaction(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRedaction);
  if (!isRecord(value)) return false;
  if (value['redacted'] === true && Object.keys(value).length === 1) return true;
  return Object.values(value).some(containsRedaction);
}

/** The manifest written back by an enable/disable: what was read, one field changed. */
export function withEnabled(resource: Resource, enabled: boolean): Json {
  if (containsRedaction(resource.spec)) {
    throw new Error(
      `${resource.kind} ${resource.name} has redacted fields; it cannot be written back`,
    );
  }
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: {
      name: resource.name,
      resourceVersion: resource.resourceVersion,
      ...(resource.labels === undefined || resource.labels === null
        ? {}
        : { labels: resource.labels }),
    },
    spec: { ...resource.spec, enabled },
  };
}

export type FunctionWrite =
  | {
      readonly op: 'promote';
      readonly name: string;
      readonly version: string;
      readonly basedOn: string | undefined;
    }
  | { readonly op: 'set-enabled'; readonly resource: Resource; readonly enabled: boolean };

export function useFunctionWrite(): ReturnType<typeof useMutation<unknown, Error, FunctionWrite>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: FunctionWrite): Promise<unknown> => {
      switch (write.op) {
        case 'promote':
          return op.request(`/v1/functions/${encodeURIComponent(write.name)}/promote`, {
            method: 'POST',
            body: JSON.stringify(
              write.basedOn === undefined
                ? { version: write.version }
                : { version: write.version, basedOn: write.basedOn },
            ),
          });
        case 'set-enabled':
          return op.request('/v1/apply', {
            method: 'POST',
            body: JSON.stringify(withEnabled(write.resource, write.enabled)),
          });
      }
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: operatorKeys.area(op.fqdn.value ?? '', 'functions') }),
  });
}
