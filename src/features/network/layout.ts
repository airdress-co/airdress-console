// One layout for the whole window (RDR-092 §7, RDR-093 §7.3): every node that
// appears anywhere in the window gets a position once, so nothing moves while
// the playhead does. x is the node's lane; y comes from a force simulation run
// to a fixed number of ticks with no timer, so the result is a pure function
// of the input.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from '@/vendor/d3/d3-force/index.js';
import type { SimulationNode } from '@/vendor/d3/d3-force/index.js';
import { KINDS } from './model.ts';
import type { Kind, Network } from './model.ts';

export const LANE_GAP = 240;
export const NODE_W = 132;
export const NODE_H = 26;
const ROW = 34;
const TICKS = 300;

interface LayoutNode extends SimulationNode {
  readonly id: string;
  readonly kind: Kind;
  x: number;
  y: number;
}

/**
 * The arrangements of RDR-095: one seeded, timer-less layout run over the
 * window, with different forces. `columns` pins each kind to a lane (boxes);
 * `groups` keeps soft lane bands and pulls each person's identities, devices
 * and sessions together (glyphs, halos); `free` drops the bands. Focus is not
 * a preset: it is `focusLayout`, laid over whichever preset is showing.
 */
export const PRESETS = ['columns', 'groups', 'free'] as const;
export type Preset = (typeof PRESETS)[number];

export interface Halo {
  /** Index of the person node the halo belongs to. */
  readonly person: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface Positions {
  readonly preset: Preset;
  /** Per node, the index of the person it belongs to, or -1 (shared: hosts, machines). */
  readonly owner: Int32Array;
  readonly halos: readonly Halo[];
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Node id to index into x and y. */
  readonly index: ReadonlyMap<string, number>;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
}

export function laneX(kind: Kind): number {
  return KINDS.indexOf(kind) * LANE_GAP;
}

/**
 * `anchors`: positions from an earlier layout. A node found there keeps its
 * place (fixed in the simulation), so growing the graph or sliding the window
 * never moves what the person has already seen; only new nodes are placed.
 */
export function layout(
  network: Network,
  anchors?: Positions,
  preset: Preset = 'columns',
): Positions {
  return preset === 'columns'
    ? columnsLayout(network, anchors)
    : forceLayout(network, preset, anchors);
}

function columnsLayout(network: Network, anchors?: Positions): Positions {
  // Initial positions are set here rather than by d3's phyllotaxis, which uses
  // Math.cos and Math.sin: those may differ in the last bit between engines,
  // and the point is a layout that is identical in every browser.
  const perLane = new Map<Kind, number>();
  const nodes: LayoutNode[] = network.nodes.map((n) => {
    const i = perLane.get(n.kind) ?? 0;
    perLane.set(n.kind, i + 1);
    // x is pinned to the lane, so collision can only separate boxes vertically.
    return { id: n.id, kind: n.kind, x: laneX(n.kind), fx: laneX(n.kind), y: i * ROW };
  });
  for (const node of nodes) node.y -= ((perLane.get(node.kind) ?? 1) * ROW) / 2;
  if (anchors !== undefined) {
    for (const node of nodes) {
      const i = anchors.index.get(node.id);
      if (i === undefined) continue;
      node.y = anchors.y[i] ?? node.y;
      node.fy = node.y;
    }
  }
  const links = network.edges.map((e) => ({ source: e.source, target: e.target }));

  const simulation = forceSimulation(nodes)
    .stop()
    .force('centre', forceY<LayoutNode>(0).strength(0.02))
    .force(
      'link',
      forceLink<LayoutNode, { source: string; target: string }>(links)
        .id((n) => n.id)
        .distance(LANE_GAP)
        .strength(0.02),
    )
    .force('collide', forceCollide<LayoutNode>(ROW / 2).iterations(2));
  simulation.tick(TICKS);
  separate(nodes);

  const x = new Float64Array(nodes.length);
  const y = new Float64Array(nodes.length);
  const index = new Map<string, number>();
  let top = Infinity;
  let bottom = -Infinity;
  nodes.forEach((node, i) => {
    // The lane wins over the simulation's x, which only has to stay near it.
    x[i] = laneX(node.kind);
    y[i] = Math.round(node.y * 100) / 100;
    index.set(node.id, i);
    top = Math.min(top, y[i] ?? 0);
    bottom = Math.max(bottom, y[i] ?? 0);
  });
  return {
    preset: 'columns',
    owner: owners(network, index),
    halos: [],
    x,
    y,
    index,
    width: (KINDS.length - 1) * LANE_GAP + NODE_W,
    top,
    bottom,
  };
}

/**
 * Who each node belongs to: a person owns the identities linked from it, an
 * identity's devices belong to the same person, and a device's sessions too.
 * Hosts and machines are shared and belong to nobody.
 */
export function owners(network: Network, index: ReadonlyMap<string, number>): Int32Array {
  const owner = new Int32Array(network.nodes.length).fill(-1);
  network.nodes.forEach((n, i) => {
    if (n.kind === 'person') owner[i] = i;
  });
  // Edges point down the lanes (person → identity → device → session), so three
  // passes in lane order settle every chain.
  for (const kind of ['identity', 'device', 'session'] as const) {
    for (const e of network.edges) {
      const s = index.get(e.source) ?? -1;
      const t = index.get(e.target) ?? -1;
      if (s < 0 || t < 0 || network.nodes[t]?.kind !== kind || owner[t] !== -1) continue;
      owner[t] = owner[s] ?? -1;
    }
  }
  return owner;
}

/** Glyph size per kind in the force presets (RDR-095 §7.2), as a collision radius. */
const GLYPH_R = 16;
const BAND = 0.55;

interface ForceNode extends SimulationNode {
  readonly id: string;
  readonly kind: Kind;
  readonly owner: number;
  x: number;
  y: number;
}

function forceLayout(network: Network, preset: Preset, anchors?: Positions): Positions {
  const index = new Map<string, number>();
  network.nodes.forEach((n, i) => index.set(n.id, i));
  const owner = owners(network, index);
  // Each person's cluster starts on its own row; shared nodes start in their
  // lane. Arithmetic only, so the start is the same in every engine.
  const people = network.nodes.flatMap((n, i) => (n.kind === 'person' ? [i] : []));
  const row = new Map<number, number>();
  people.forEach((p, k) => row.set(p, k));
  const seen = new Map<number, number>();
  const nodes: ForceNode[] = network.nodes.map((n, i) => {
    const o = owner[i] ?? -1;
    const k = seen.get(o) ?? 0;
    seen.set(o, k + 1);
    const base = o >= 0 ? (row.get(o) ?? 0) * 140 : (k % 40) * 30;
    return {
      id: n.id,
      kind: n.kind,
      owner: o,
      x: laneX(n.kind) * BAND + (k % 5) * 9,
      y: base + (k % 7) * 11 - (people.length * 140) / 2,
    };
  });
  if (anchors !== undefined) {
    for (const node of nodes) {
      const i = anchors.index.get(node.id);
      if (i === undefined) continue;
      node.x = anchors.x[i] ?? node.x;
      node.y = anchors.y[i] ?? node.y;
      node.fx = node.x;
      node.fy = node.y;
    }
  }
  const links = network.edges.map((e) => ({ source: e.source, target: e.target }));

  // Pull each owned node toward its person's current centroid.
  const cluster = (alpha: number): void => {
    const sx = new Map<number, number>();
    const sy = new Map<number, number>();
    const count = new Map<number, number>();
    for (const n of nodes) {
      if (n.owner < 0) continue;
      sx.set(n.owner, (sx.get(n.owner) ?? 0) + n.x);
      sy.set(n.owner, (sy.get(n.owner) ?? 0) + n.y);
      count.set(n.owner, (count.get(n.owner) ?? 0) + 1);
    }
    for (const n of nodes) {
      if (n.owner < 0) continue;
      const c = count.get(n.owner) ?? 1;
      n.vx = (n.vx ?? 0) + ((sx.get(n.owner) ?? 0) / c - n.x) * 0.3 * alpha;
      n.vy = (n.vy ?? 0) + ((sy.get(n.owner) ?? 0) / c - n.y) * 0.3 * alpha;
    }
  };

  const simulation = forceSimulation(nodes)
    .stop()
    .force(
      'link',
      forceLink<ForceNode, { source: string; target: string }>(links)
        .id((n) => n.id)
        .distance(46)
        // Links into a shared host pull weakly, or every cluster collapses onto it.
        .strength((l) =>
          typeof l.target === 'object' && (l.target as ForceNode).kind === 'host' ? 0.03 : 0.45,
        ),
    )
    .force('charge', forceManyBody<ForceNode>().strength(-55).distanceMax(400))
    .force('collide', forceCollide<ForceNode>(GLYPH_R).iterations(3))
    .force('cluster', cluster)
    .force(
      'band',
      forceX<ForceNode>((n) => laneX(n.kind) * BAND).strength(preset === 'groups' ? 0.18 : 0),
    )
    .force('centreX', forceX<ForceNode>(LANE_GAP * 2 * BAND).strength(preset === 'free' ? 0.03 : 0))
    .force('centreY', forceY<ForceNode>(0).strength(0.03));
  simulation.tick(TICKS);

  const x = new Float64Array(nodes.length);
  const y = new Float64Array(nodes.length);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  nodes.forEach((n, i) => {
    x[i] = Math.round(n.x * 100) / 100;
    y[i] = Math.round(n.y * 100) / 100;
    left = Math.min(left, x[i] ?? 0);
    right = Math.max(right, x[i] ?? 0);
    top = Math.min(top, y[i] ?? 0);
    bottom = Math.max(bottom, y[i] ?? 0);
  });
  // Shift so the layout starts at x = 0 like the columns do; never when
  // anchored, or the shift itself would move every node already placed.
  if (anchors === undefined) for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) - left + GLYPH_R;
  const halos: Halo[] = [];
  for (const p of people) {
    const members = nodes.flatMap((n, i) => (n.owner === p ? [i] : []));
    if (members.length < 2) continue;
    const cx = members.reduce((s, i) => s + (x[i] ?? 0), 0) / members.length;
    const cy = members.reduce((s, i) => s + (y[i] ?? 0), 0) / members.length;
    // The 85th percentile, so one far-flung session does not inflate the halo.
    const d = members
      .map((i) => Math.hypot((x[i] ?? 0) - cx, (y[i] ?? 0) - cy))
      .sort((a, b) => a - b);
    const r = (d[Math.floor(d.length * 0.85)] ?? 0) + 20;
    halos.push({ person: p, x: cx, y: cy, r });
  }
  return { preset, owner, halos, x, y, index, width: right - left + 2 * GLYPH_R, top, bottom };
}

/**
 * Focus (RDR-095 §7.2): the selection at the centre, what is one association
 * away on the first ring, two away on the second, everything else on a third,
 * dimmed by the renderer. A separate, disposable layout: the base map is not
 * touched, so leaving Focus returns to the same picture.
 */
export function focusLayout(
  network: Network,
  base: Positions,
  centre: number,
): Positions & { readonly hop: Uint8Array } {
  const n = network.nodes.length;
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const e of network.edges) {
    const s = base.index.get(e.source) ?? -1;
    const t = base.index.get(e.target) ?? -1;
    if (s < 0 || t < 0) continue;
    adjacency[s]?.push(t);
    adjacency[t]?.push(s);
  }
  const hop = new Uint8Array(n).fill(3);
  hop[centre] = 0;
  let frontier = [centre];
  for (let h = 1; h <= 2; h++) {
    const next: number[] = [];
    for (const a of frontier) {
      for (const b of adjacency[a] ?? []) {
        if (hop[b] !== 3 || b === centre) continue;
        hop[b] = h;
        next.push(b);
      }
    }
    frontier = next;
  }
  const kindOrder = (i: number): number => KINDS.indexOf(network.nodes[i]?.kind ?? 'device');
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const R = [0, 110, 220, 330];
  for (let ring = 1; ring <= 3; ring++) {
    const members = [...Array(n).keys()].filter((i) => hop[i] === ring);
    members.sort(
      (a, b) =>
        (base.owner[a] ?? -1) - (base.owner[b] ?? -1) || kindOrder(a) - kindOrder(b) || a - b,
    );
    members.forEach((i, k) => {
      const angle = (2 * Math.PI * k) / Math.max(1, members.length);
      x[i] = (R[ring] ?? 0) * Math.cos(angle);
      y[i] = (R[ring] ?? 0) * Math.sin(angle);
    });
  }
  const extent = R[3] ?? 0;
  for (let i = 0; i < n; i++) x[i] = (x[i] ?? 0) + extent + GLYPH_R;
  return {
    preset: base.preset === 'columns' ? 'groups' : base.preset,
    owner: base.owner,
    halos: [],
    x,
    y,
    index: base.index,
    width: 2 * extent + 2 * GLYPH_R,
    top: -extent,
    bottom: extent,
    hop,
  };
}

/**
 * The simulation decides each lane's order; this pass guarantees the spacing.
 * Per lane, sorted by y, a box that sits closer than a row to the one above is
 * pushed down, then the lane is re-centred on where it was. Anchored nodes
 * (fy set) are left where they are and the free ones flow around them.
 */
function separate(nodes: LayoutNode[]): void {
  const lanes = new Map<Kind, LayoutNode[]>();
  for (const node of nodes) {
    const lane = lanes.get(node.kind) ?? [];
    lane.push(node);
    lanes.set(node.kind, lane);
  }
  for (const lane of lanes.values()) {
    lane.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
    const fixed = lane.filter((n) => n.fy !== undefined && n.fy !== null);
    if (fixed.length === 0) {
      const before = lane.reduce((sum, n) => sum + n.y, 0) / lane.length;
      for (let i = 1; i < lane.length; i++) {
        const prev = lane[i - 1];
        const node = lane[i];
        if (prev !== undefined && node !== undefined && node.y - prev.y < ROW)
          node.y = prev.y + ROW;
      }
      const shift = before - lane.reduce((sum, n) => sum + n.y, 0) / lane.length;
      for (const node of lane) node.y += shift;
      continue;
    }
    // Anchored lane: the known nodes stay; each new one takes the nearest
    // free slot at or below where the simulation put it.
    const taken = fixed.map((n) => n.y).sort((a, b) => a - b);
    for (const node of lane) {
      if (node.fy !== undefined && node.fy !== null) continue;
      let y = node.y;
      for (const t of taken) {
        if (t > y - ROW && t < y + ROW) y = t + ROW;
      }
      node.y = y;
      taken.push(y);
      taken.sort((a, b) => a - b);
    }
  }
}

/** FNV-1a over the rounded positions: equal hashes mean equal layouts. */
export function layoutHash(p: Positions): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < p.y.length; i++) {
    const s = `${String(p.x[i])},${String(p.y[i])};`;
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

/** Mean distance moved by the nodes two layouts share. */
export function displacement(a: Positions, b: Positions): number {
  let sum = 0;
  let n = 0;
  for (const [id, i] of a.index) {
    const j = b.index.get(id);
    if (j === undefined) continue;
    sum += Math.hypot((a.x[i] ?? 0) - (b.x[j] ?? 0), (a.y[i] ?? 0) - (b.y[j] ?? 0));
    n++;
  }
  return n === 0 ? 0 : sum / n;
}
