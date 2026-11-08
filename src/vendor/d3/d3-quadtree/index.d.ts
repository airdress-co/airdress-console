// Types for the part of the vendored d3-quadtree 3.0.1 the network view uses.

export interface Quadtree<T> {
  x(fn: (d: T) => number): this;
  y(fn: (d: T) => number): this;
  addAll(data: T[]): this;
  find(x: number, y: number, radius?: number): T | undefined;
}

export function quadtree<T>(): Quadtree<T>;
