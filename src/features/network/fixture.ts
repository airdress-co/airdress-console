// A seeded, deterministic network for the renderer spike (SPEC-189 189-0.2,
// RDR-093 §7.5): N nodes over five lanes, about 5N edges, about 16.7N events
// over a 30-day window. The same seed gives the same network in every
// browser, so layout hashes can be compared across engines.
import type { ClosedBy, EdgeStyle, Kind, NetEdge, NetEvent, NetNode, Network } from './model.ts';

/** mulberry32: small, fast and identical in every engine (integer maths only). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHARE: Readonly<Record<Kind, number>> = {
  person: 0.08,
  identity: 0.12,
  device: 0.35,
  session: 0.3,
  host: 0.15,
};

// Which lanes an edge joins, how often, and whether it is exercised or standing.
const LINKS: readonly (readonly [Kind, Kind, EdgeStyle, number])[] = [
  ['person', 'identity', 'could', 0.08],
  ['identity', 'device', 'could', 0.22],
  ['device', 'session', 'used', 0.4],
  ['session', 'host', 'used', 0.2],
  ['device', 'host', 'could', 0.1],
];

const DAY = 86_400_000;

export interface FixtureSize {
  readonly nodes: number;
  readonly edges?: number;
  readonly events?: number;
  readonly days?: number;
  /** Start of the window, epoch ms. */
  readonly from?: number;
}

export function fixture(seed: number, size: FixtureSize): Network {
  const random = rng(seed);
  const days = size.days ?? 30;
  const from = size.from ?? Date.UTC(2026, 9, 9);
  const to = from + days * DAY;
  const edgeCount = size.edges ?? size.nodes * 5;
  const eventCount = size.events ?? Math.round((size.nodes * 50) / 3);

  const byKind = new Map<Kind, NetNode[]>();
  const nodes: NetNode[] = [];
  for (const [kind, share] of Object.entries(SHARE) as [Kind, number][]) {
    const count = Math.max(1, Math.round(size.nodes * share));
    const lane: NetNode[] = [];
    for (let i = 0; i < count; i++) {
      const node = { id: `${kind}-${String(i)}`, kind, label: `${kind} ${String(i)}` };
      lane.push(node);
      nodes.push(node);
    }
    byKind.set(kind, lane);
  }
  const pick = (kind: Kind): NetNode => {
    const lane = byKind.get(kind) ?? [];
    const node = lane[Math.floor(random() * lane.length)];
    if (node === undefined) throw new Error(`empty lane ${kind}`);
    return node;
  };

  const edges: NetEdge[] = [];
  for (let i = 0; i < edgeCount; i++) {
    let r = random();
    let link = LINKS[LINKS.length - 1];
    for (const candidate of LINKS) {
      if (r < candidate[3]) {
        link = candidate;
        break;
      }
      r -= candidate[3];
    }
    if (link === undefined) throw new Error('no link kinds');
    const [a, b, style] = link;
    // Standing access mostly predates the window and lasts; a session leg is minutes to hours.
    const start =
      style === 'could'
        ? from + (random() * 1.4 - 0.4) * (to - from)
        : from + random() * (to - from - DAY);
    const length = style === 'could' ? random() * 40 * DAY : (5 + random() * 300) * 60_000;
    const endAt = start + length;
    const open = endAt >= to;
    const closedBy: ClosedBy | null = open
      ? null
      : start < from && random() < 0.3
        ? 'unconfirmed'
        : random() < 0.2
          ? 'sweep'
          : 'event';
    edges.push({
      id: `e-${String(i)}`,
      source: pick(a).id,
      target: pick(b).id,
      style,
      start,
      end: open ? null : endAt,
      closedBy,
    });
  }

  const events: NetEvent[] = [];
  for (const edge of edges) {
    if (edge.start >= from) events.push({ t: edge.start, name: 'opened', edge: edge.id });
    if (edge.end !== null && edge.closedBy === 'event') {
      events.push({ t: edge.end, name: 'closed', edge: edge.id });
    }
  }
  while (events.length < eventCount) {
    const edge = edges[Math.floor(random() * edges.length)];
    if (edge === undefined) break;
    const lo = Math.max(edge.start, from);
    const hi = Math.min(edge.end ?? to, to);
    if (hi <= lo) continue;
    events.push({ t: lo + random() * (hi - lo), name: 'used', edge: edge.id });
  }
  events.length = Math.min(events.length, eventCount);
  events.sort((x, y) => x.t - y.t || (x.edge < y.edge ? -1 : 1));
  return { from, to, nodes, edges, events };
}
