// One layout for the whole window (RDR-092 §7, RDR-093 §7.3): every node that
// appears anywhere in the window gets a position once, so nothing moves while
// the playhead does. x is the node's lane; y comes from a force simulation run
// to a fixed number of ticks with no timer, so the result is a pure function
// of the input.
import { forceCollide, forceLink, forceSimulation, forceY } from '@/vendor/d3/d3-force/index.js';
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

export interface Positions {
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
export function layout(network: Network, anchors?: Positions): Positions {
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
  return { x, y, index, width: (KINDS.length - 1) * LANE_GAP + NODE_W, top, bottom };
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
