// State at an instant (RDR-092 §7): which associations hold and which nodes
// are present. Moving forward applies only the boundaries crossed since the
// last call, so a replay costs O(boundaries crossed) per frame; moving back
// rebuilds from the window start.
import type { Network } from './model.ts';

export interface State {
  readonly t: number;
  /** 1 where the edge holds at t. */
  readonly edgeOn: Uint8Array;
  /** 1 where the edge ended inside the window, before t. */
  readonly edgeEnded: Uint8Array;
  /** Number of holding edges per node; > 0 means present. */
  readonly nodeDegree: Uint32Array;
  /** Index of the last event at or before t, or -1. */
  readonly eventIndex: number;
}

export class Replay {
  private readonly times: Float64Array;
  private readonly edgeOf: Uint32Array;
  private readonly delta: Int8Array;
  private readonly src: Uint32Array;
  private readonly dst: Uint32Array;
  private readonly edgeOn: Uint8Array;
  private readonly edgeEnded: Uint8Array;
  private readonly nodeDegree: Uint32Array;
  private cursor = 0;
  private t: number;

  constructor(
    private readonly network: Network,
    nodeIndex: ReadonlyMap<string, number>,
  ) {
    const { edges, from } = network;
    const marks: [number, number, 1 | -1][] = [];
    edges.forEach((e, i) => {
      marks.push([Math.max(e.start, from), i, 1]);
      if (e.end !== null && e.end < network.to) marks.push([Math.max(e.end, from), i, -1]);
    });
    // Ends before starts at the same instant: a hand-over never shows both.
    marks.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    this.times = Float64Array.from(marks, (m) => m[0]);
    this.edgeOf = Uint32Array.from(marks, (m) => m[1]);
    this.delta = Int8Array.from(marks, (m) => m[2]);
    this.src = Uint32Array.from(edges, (e) => nodeIndex.get(e.source) ?? 0);
    this.dst = Uint32Array.from(edges, (e) => nodeIndex.get(e.target) ?? 0);
    this.edgeOn = new Uint8Array(edges.length);
    this.edgeEnded = new Uint8Array(edges.length);
    this.nodeDegree = new Uint32Array(network.nodes.length);
    this.t = -Infinity;
  }

  at(t: number): State {
    if (t < this.t) this.reset();
    while (this.cursor < this.times.length && (this.times[this.cursor] ?? Infinity) <= t) {
      const e = this.edgeOf[this.cursor] ?? 0;
      const d = this.delta[this.cursor] ?? 0;
      const s = this.src[e] ?? 0;
      const g = this.dst[e] ?? 0;
      if (d > 0) {
        this.edgeOn[e] = 1;
        this.nodeDegree[s] = (this.nodeDegree[s] ?? 0) + 1;
        this.nodeDegree[g] = (this.nodeDegree[g] ?? 0) + 1;
      } else if (this.edgeOn[e] === 1) {
        this.edgeOn[e] = 0;
        this.edgeEnded[e] = 1;
        this.nodeDegree[s] = (this.nodeDegree[s] ?? 1) - 1;
        this.nodeDegree[g] = (this.nodeDegree[g] ?? 1) - 1;
      }
      this.cursor++;
    }
    this.t = t;
    return {
      t,
      edgeOn: this.edgeOn,
      edgeEnded: this.edgeEnded,
      nodeDegree: this.nodeDegree,
      eventIndex: lastAtOrBefore(this.network.events, t),
    };
  }

  private reset(): void {
    this.cursor = 0;
    this.edgeOn.fill(0);
    this.edgeEnded.fill(0);
    this.nodeDegree.fill(0);
    this.t = -Infinity;
  }
}

function lastAtOrBefore(events: Network['events'], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid]?.t ?? Infinity) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
