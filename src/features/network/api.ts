// The network view's read (SPEC-189, proof of concept): GET /v1/admin/network
// for a window, checked where it enters and turned into the renderer's model.
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { Ref } from 'vue';
import type { Reader } from '@/api/guards.ts';
import { Reader as R } from '@/api/guards.ts';
import { useOperator } from '@/operator/use-operator.ts';
import { operatorKeys } from '@/query/keys.ts';
import { KINDS } from './model.ts';
import type { ClosedBy, Kind, NetEdge, NetEvent, NetNode, Network } from './model.ts';

const PATH = '/v1/admin/network';

/** What the view shows beyond the renderer's model: names and provenance. */
export interface NetworkRead {
  readonly network: Network;
  /** Interval id → the operator's name for the association and whether it was reconstructed. */
  readonly association: ReadonlyMap<
    string,
    { readonly name: string; readonly backfilled: boolean }
  >;
  /** Node id → what it is within its lane (owner, sub_user, root_key, shell_host …). */
  readonly detail: ReadonlyMap<string, string>;
  readonly eventsFrom: number | undefined;
  readonly eventsTruncated: boolean;
  /** When the operator's recorded history begins: nothing earlier is known. */
  readonly historyStartsAt: number | undefined;
}

function kindOf(r: Reader): Kind {
  const kind = r.string('kind');
  return (KINDS as readonly string[]).includes(kind) ? (kind as Kind) : 'host';
}

function closedOf(r: Reader): ClosedBy | null {
  const c = r.optString('closed_by');
  return c === 'event' || c === 'sweep' || c === 'unconfirmed' ? c : null;
}

export function readNetwork(body: unknown): NetworkRead {
  const r = R.of(PATH, body);
  const detail = new Map<string, string>();
  const nodes: NetNode[] = r.list('nodes', (n) => {
    detail.set(n.string('id'), n.string('detail'));
    return { id: n.string('id'), kind: kindOf(n), label: n.string('label') };
  }) as NetNode[];
  const association = new Map<string, { name: string; backfilled: boolean }>();
  const edges: NetEdge[] = r.list('intervals', (i) => {
    const id = i.string('id');
    association.set(id, {
      name: i.string('association'),
      backfilled: i.optBoolean('backfilled') ?? false,
    });
    const end = i.optString('end');
    return {
      id,
      source: i.string('source'),
      target: i.string('target'),
      style: i.string('style') === 'used' ? 'used' : 'could',
      start: Date.parse(i.string('start')),
      end: end === undefined ? null : Date.parse(end),
      closedBy: closedOf(i),
    };
  }) as NetEdge[];
  const events: NetEvent[] = r.list('events', (e) => ({
    t: Date.parse(e.string('time')),
    name: e.string('name'),
    edge: '',
  })) as NetEvent[];
  const coverage = r.record('coverage');
  const eventsFrom = coverage.optString('events_from');
  const historyStartsAt = coverage.optString('history_starts_at');
  return {
    network: {
      from: Date.parse(r.string('from')),
      to: Date.parse(r.string('to')),
      nodes,
      edges,
      events,
    },
    association,
    detail,
    eventsFrom: eventsFrom === undefined ? undefined : Date.parse(eventsFrom),
    eventsTruncated: coverage.optBoolean('events_truncated') ?? false,
    historyStartsAt: historyStartsAt === undefined ? undefined : Date.parse(historyStartsAt),
  };
}

export type WindowName = 'day' | 'week' | 'month';
const SPAN: Readonly<Record<WindowName, number>> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 31 * 86_400_000,
};

/** The window ends at the minute the area was opened, so the query key is stable. */
export function windowOf(name: WindowName, now: number): { from: string; to: string } {
  const to = Math.floor(now / 60_000) * 60_000;
  return { from: new Date(to - SPAN[name]).toISOString(), to: new Date(to).toISOString() };
}

export function useNetwork(
  window: Ref<{ from: string; to: string }>,
): ReturnType<typeof useQuery<NetworkRead>> {
  const op = useOperator();
  return useQuery({
    queryKey: computed(() =>
      operatorKeys.network(op.fqdn.value ?? '', window.value.from, window.value.to),
    ),
    queryFn: async () => {
      const q = new URLSearchParams({ from: window.value.from, to: window.value.to });
      return readNetwork(await op.request(`${PATH}?${q.toString()}`));
    },
    enabled: computed(() => op.fqdn.value !== undefined),
  });
}

const SETTINGS = '/v1/admin/network/settings';

/** The owner turns the view on or off (SPEC-189 FR-46); the read refetches. */
export function useNetworkSwitch(): ReturnType<typeof useMutation<unknown, Error, boolean>> {
  const op = useOperator();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean): Promise<unknown> =>
      op.request(SETTINGS, { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSettled: () => client.invalidateQueries({ queryKey: operatorKeys.all(op.fqdn.value ?? '') }),
  });
}
