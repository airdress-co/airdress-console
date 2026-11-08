// Types for the part of the vendored d3-force 3.0.0 the network view uses.
// Hand-written (no @types package reaches the bundle); see ../VENDOR.md.

export interface SimulationNode {
  index?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface SimulationLink<N extends SimulationNode> {
  source: N | string | number;
  target: N | string | number;
}

export interface Force<N extends SimulationNode> {
  (alpha: number): void;
  initialize?(nodes: N[], random: () => number): void;
}

export interface Simulation<N extends SimulationNode> {
  stop(): this;
  tick(iterations?: number): this;
  nodes(): N[];
  alpha(a: number): this;
  alphaDecay(d: number): this;
  force(name: string, force: Force<N> | null): this;
}

export function forceSimulation<N extends SimulationNode>(nodes?: N[]): Simulation<N>;

export interface ForceX<N extends SimulationNode> extends Force<N> {
  strength(s: number): this;
  x(x: number | ((n: N) => number)): this;
}
export function forceX<N extends SimulationNode>(x?: number | ((n: N) => number)): ForceX<N>;

export interface ForceY<N extends SimulationNode> extends Force<N> {
  strength(s: number): this;
  y(y: number | ((n: N) => number)): this;
}
export function forceY<N extends SimulationNode>(y?: number | ((n: N) => number)): ForceY<N>;

export interface ForceCollide<N extends SimulationNode> extends Force<N> {
  radius(r: number | ((n: N) => number)): this;
  strength(s: number): this;
  iterations(i: number): this;
}
export function forceCollide<N extends SimulationNode>(radius?: number): ForceCollide<N>;

export interface ForceLink<N extends SimulationNode, L extends SimulationLink<N>> extends Force<N> {
  id(id: (n: N) => string): this;
  distance(d: number | ((l: L) => number)): this;
  strength(s: number | ((l: L) => number)): this;
}
export function forceLink<N extends SimulationNode, L extends SimulationLink<N>>(
  links?: L[],
): ForceLink<N, L>;
