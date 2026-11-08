// Shared by both spike pages: the fixture from the query string, the
// window-wide layout, the stability measurements and frame statistics.
import { fixture, household } from '@/features/network/fixture.ts';
import { displacement, layout, layoutHash, PRESETS } from '@/features/network/layout.ts';
import type { Preset } from '@/features/network/layout.ts';
import type { Positions } from '@/features/network/layout.ts';
import type { NetEdge, NetNode, Network } from '@/features/network/model.ts';

export interface Setup {
  readonly n: number;
  readonly seed: number;
  readonly network: Network;
  readonly positions: Positions;
  readonly layoutMs: number;
  readonly hash: string;
  readonly preset: Preset;
}

export function setup(): Setup {
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('n') ?? 300);
  const seed = Number(q.get('seed') ?? 7);
  const asked = q.get('preset') ?? 'columns';
  const preset: Preset = (PRESETS as readonly string[]).includes(asked)
    ? (asked as Preset)
    : 'columns';
  const network =
    q.get('fixture') === 'household' ? household(seed, { nodes: n }) : fixture(seed, { nodes: n });
  const started = performance.now();
  const positions = layout(network, undefined, preset);
  const layoutMs = performance.now() - started;
  return { n, seed, network, positions, layoutMs, hash: layoutHash(positions), preset };
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

export function summary(values: readonly number[]): {
  p50: number;
  p95: number;
  max: number;
  n: number;
} {
  const r = (x: number): number => Math.round(x * 100) / 100;
  return {
    p50: r(percentile(values, 50)),
    p95: r(percentile(values, 95)),
    max: r(Math.max(0, ...values)),
    n: values.length,
  };
}

/** Records requestAnimationFrame intervals until stopped: dropped frames show here. */
export function frameClock(): { stop: () => number[] } {
  const deltas: number[] = [];
  let last = performance.now();
  let running = true;
  const tick = (now: number): void => {
    deltas.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      running = false;
      return deltas.slice(1);
    },
  };
}

/**
 * RDR-093 §7.5 item 4: (a) add 10% new nodes, each joined to the existing
 * graph, and (b) slide a 30-day window by five days over a 35-day network.
 * Both report the mean distance the shared nodes moved.
 */
export function stability(
  seed: number,
  n: number,
  preset: Preset = 'columns',
): {
  addTenPercent: number;
  shiftWindow: number;
  addTenPercentAnchored: number;
  shiftWindowAnchored: number;
  anchoredOverlaps: number;
  baseOverlaps: number;
} {
  let baseOverlaps = 0;
  const base = fixture(seed, { nodes: n });
  const extra = fixture(seed + 1, { nodes: Math.round(n / 10) });
  const rename = (id: string): string => `x-${id}`;
  const extraNodes: NetNode[] = extra.nodes.map((node) => ({ ...node, id: rename(node.id) }));
  const bridges: NetEdge[] = extraNodes.map((node, i) => {
    const anchor = base.nodes[(i * 7) % base.nodes.length];
    return {
      id: `bridge-${String(i)}`,
      source: anchor?.id ?? node.id,
      target: node.id,
      style: 'could',
      start: base.from,
      end: null,
      closedBy: null,
    };
  });
  const grown: Network = {
    ...base,
    nodes: [...base.nodes, ...extraNodes],
    edges: [
      ...base.edges,
      ...extra.edges.map((e) => ({
        ...e,
        id: rename(e.id),
        source: rename(e.source),
        target: rename(e.target),
      })),
      ...bridges,
    ],
  };
  const baseLayout = layout(base, undefined, preset);
  const addTenPercent = displacement(baseLayout, layout(grown, undefined, preset));
  const grownAnchored = layout(grown, baseLayout, preset);
  const addTenPercentAnchored = displacement(baseLayout, grownAnchored);

  const long = fixture(seed, { nodes: n, days: 35 });
  const day = 86_400_000;
  const windowOf = (from: number, to: number): Network => {
    const edges = long.edges.filter((e) => e.start < to && (e.end ?? Infinity) > from);
    const ids = new Set(edges.flatMap((e) => [e.source, e.target]));
    return { ...long, from, to, edges, nodes: long.nodes.filter((node) => ids.has(node.id)) };
  };
  const first = layout(windowOf(long.from, long.from + 30 * day), undefined, preset);
  const shifted = windowOf(long.from + 5 * day, long.to);
  const shiftWindow = displacement(first, layout(shifted, undefined, preset));
  const shiftWindowAnchored = displacement(first, layout(shifted, first, preset));
  // Overlaps: two boxes in one lane whose centres are closer than a box height.
  const overlaps = (p: Positions): number => {
    if (p.preset !== 'columns') return overlaps2d(p);
    let count = 0;
    const lanes = new Map<number, number[]>();
    p.index.forEach((i) => {
      const x = p.x[i] ?? 0;
      const list = lanes.get(x) ?? [];
      list.push(p.y[i] ?? 0);
      lanes.set(x, list);
    });
    for (const ys of lanes.values()) {
      ys.sort((a, b) => a - b);
      for (let k = 1; k < ys.length; k++) if ((ys[k] ?? 0) - (ys[k - 1] ?? 0) < 26) count++;
    }
    return count;
  };
  const anchoredOverlaps = overlaps(grownAnchored);
  baseOverlaps = overlaps(baseLayout);
  return {
    addTenPercent: Math.round(addTenPercent * 10) / 10,
    shiftWindow: Math.round(shiftWindow * 10) / 10,
    addTenPercentAnchored: Math.round(addTenPercentAnchored * 10) / 10,
    shiftWindowAnchored: Math.round(shiftWindowAnchored * 10) / 10,
    anchoredOverlaps,
    baseOverlaps,
  };
}

/** Collects CSP violations from the first script onward. */
export const violations: string[] = [];
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push(
    `${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${String(e.lineNumber)}`,
  );
});

/** Glyph presets: pairs of nodes whose centres are closer than two glyph radii (24 px). */
export function overlaps2d(p: Positions): number {
  let count = 0;
  const n = p.x.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot((p.x[i] ?? 0) - (p.x[j] ?? 0), (p.y[i] ?? 0) - (p.y[j] ?? 0)) < 24) count++;
    }
  }
  return count;
}

/** Edge crossings of the straight-line (or, for columns, lane-to-lane) drawing. */
export function crossings(network: Network, p: Positions): number {
  const seg = network.edges.map((e) => {
    const a = p.index.get(e.source) ?? 0;
    const b = p.index.get(e.target) ?? 0;
    const dx = p.preset === 'columns' ? 132 : 0;
    return [(p.x[a] ?? 0) + dx, p.y[a] ?? 0, p.x[b] ?? 0, p.y[b] ?? 0, a, b] as const;
  });
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  let count = 0;
  for (let i = 0; i < seg.length; i++) {
    const s1 = seg[i];
    if (s1 === undefined) continue;
    for (let j = i + 1; j < seg.length; j++) {
      const s2 = seg[j];
      if (s2 === undefined) continue;
      if (s1[4] === s2[4] || s1[4] === s2[5] || s1[5] === s2[4] || s1[5] === s2[5]) continue;
      const o1 = orient(s1[0], s1[1], s1[2], s1[3], s2[0], s2[1]);
      const o2 = orient(s1[0], s1[1], s1[2], s1[3], s2[2], s2[3]);
      const o3 = orient(s2[0], s2[1], s2[2], s2[3], s1[0], s1[1]);
      const o4 = orient(s2[0], s2[1], s2[2], s2[3], s1[2], s1[3]);
      if (o1 !== o2 && o3 !== o4) count++;
    }
  }
  return count;
}
