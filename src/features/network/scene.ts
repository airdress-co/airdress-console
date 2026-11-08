// The Canvas 2D renderer (SPEC-189 D-1): draws the state at an instant over
// the window-wide layout. Paths are batched by style and colour, so the cost
// is a handful of stroke/fill calls plus one fillText per readable label.
// Hit-testing goes through a quadtree of node centres, built once.
import { quadtree } from '@/vendor/d3/d3-quadtree/index.js';
import type { Quadtree } from '@/vendor/d3/d3-quadtree/index.js';
import { NODE_H, NODE_W } from './layout.ts';
import type { Positions } from './layout.ts';
import { KINDS } from './model.ts';
import type { Kind, Network } from './model.ts';
import type { State } from './replay.ts';

export interface Palette {
  readonly ground: string;
  readonly ink: string;
  readonly muted: string;
  readonly faint: string;
  readonly kind: Readonly<Record<Kind, string>>;
}

export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };
  return {
    ground: v('--net-ground', '#ffffff'),
    ink: v('--net-ink', '#141b24'),
    muted: v('--net-muted', '#7a8694'),
    faint: v('--net-faint', '#d5dbe1'),
    kind: {
      person: v('--net-person', '#2aa88e'),
      identity: v('--net-identity', '#2f5a87'),
      device: v('--net-device', '#4f86e8'),
      session: v('--net-session', '#7a8694'),
      host: v('--net-host', '#d9822b'),
    },
  };
}

export interface View {
  /** Scale from layout units to CSS pixels. */
  scale: number;
  /** Layout point shown at the canvas's top-left corner. */
  originX: number;
  originY: number;
}

/** Spike levers (189-0.2): which of the two cheap optimisations are on. */
export interface SceneOptions {
  /** Draw node boxes and labels once per view into a second canvas. */
  readonly cache: boolean;
  /** Dashed standing edges (false: solid at reduced alpha). */
  readonly dashes: boolean;
}

export interface DrawStats {
  readonly edges: number;
  readonly nodes: number;
  readonly labels: number;
}

export class Scene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tree: Quadtree<number>;
  private readonly src: Uint32Array;
  private readonly dst: Uint32Array;
  private readonly kindOf: Uint8Array;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly network: Network,
    private readonly pos: Positions,
    private palette: Palette,
    private readonly options: SceneOptions = { cache: false, dashes: true },
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('no 2D context');
    this.ctx = ctx;
    this.src = Uint32Array.from(network.edges, (e) => pos.index.get(e.source) ?? 0);
    this.dst = Uint32Array.from(network.edges, (e) => pos.index.get(e.target) ?? 0);
    this.kindOf = Uint8Array.from(network.nodes, (n) => KINDS.indexOf(n.kind));
    this.tree = quadtree<number>()
      .x((i) => (pos.x[i] ?? 0) + NODE_W / 2)
      .y((i) => pos.y[i] ?? 0)
      .addAll(network.nodes.map((_, i) => i));
  }

  private layer: HTMLCanvasElement | undefined;
  private layerKey = '';

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.layerKey = '';
  }

  /** The static layer: every node's box (absent style) and label, for one view. */
  private staticLayer(view: View): HTMLCanvasElement {
    const key = `${String(view.scale)}|${String(view.originX)}|${String(view.originY)}|${String(this.canvas.width)}x${String(this.canvas.height)}`;
    if (this.layer !== undefined && key === this.layerKey) return this.layer;
    const layer = this.layer ?? document.createElement('canvas');
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('no 2D context');
    const { pos, palette } = this;
    const k = view.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, layer.width, layer.height);
    ctx.setTransform(k, 0, 0, k, -view.originX * k, -view.originY * k);
    ctx.lineWidth = 1.25 / view.scale;
    ctx.beginPath();
    for (let i = 0; i < this.network.nodes.length; i++) {
      ctx.roundRect(pos.x[i] ?? 0, (pos.y[i] ?? 0) - NODE_H / 2, NODE_W, NODE_H, 5);
    }
    ctx.strokeStyle = palette.faint;
    ctx.stroke();
    if (12 * view.scale >= 7) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = palette.ink;
      for (let i = 0; i < this.network.nodes.length; i++) {
        ctx.fillText(
          this.network.nodes[i]?.label ?? '',
          (pos.x[i] ?? 0) + 10,
          pos.y[i] ?? 0,
          NODE_W - 16,
        );
      }
    }
    this.layer = layer;
    this.layerKey = key;
    return layer;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  /** The view that fits the whole layout, with a margin. */
  fit(): View {
    const margin = 24;
    const h = this.pos.bottom - this.pos.top + NODE_H;
    const scale = Math.min(
      (this.cssW - 2 * margin) / this.pos.width,
      (this.cssH - 2 * margin) / Math.max(h, 1),
    );
    return {
      scale,
      originX: -margin / scale,
      originY: this.pos.top - NODE_H / 2 - margin / scale,
    };
  }

  /** The node under a canvas point (CSS pixels), if any. */
  hit(view: View, px: number, py: number): number | undefined {
    const lx = view.originX + px / view.scale;
    const ly = view.originY + py / view.scale;
    const i = this.tree.find(lx, ly, NODE_W / 2);
    if (i === undefined) return undefined;
    const x = this.pos.x[i] ?? 0;
    const y = this.pos.y[i] ?? 0;
    return lx >= x && lx <= x + NODE_W && Math.abs(ly - y) <= NODE_H / 2 ? i : undefined;
  }

  draw(
    state: State,
    view: View,
    focus: number | undefined,
    selected: number | undefined,
    flush = false,
  ): DrawStats {
    const { ctx, pos, palette, src, dst } = this;
    const k = view.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.options.cache) ctx.drawImage(this.staticLayer(view), 0, 0);
    else {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(k, 0, 0, k, -view.originX * k, -view.originY * k);
    ctx.lineWidth = 1.25 / view.scale;

    // Edges, in three batches: ended (faint), standing (dashed), used (solid).
    const edgeCount = this.network.edges.length;
    const styles = this.network.edges;
    let drawnEdges = 0;
    const pass = (pick: (e: number) => boolean, stroke: string, dash: readonly number[]): void => {
      ctx.beginPath();
      for (let e = 0; e < edgeCount; e++) {
        if (!pick(e)) continue;
        const a = src[e] ?? 0;
        const b = dst[e] ?? 0;
        const x1 = (pos.x[a] ?? 0) + NODE_W;
        const y1 = pos.y[a] ?? 0;
        const x2 = pos.x[b] ?? 0;
        const y2 = pos.y[b] ?? 0;
        const mx = (x1 + x2) / 2;
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
        drawnEdges++;
      }
      ctx.setLineDash(dash.map((d) => d / view.scale));
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    pass(
      (e) => state.edgeEnded[e] === 1 && state.edgeOn[e] === 0,
      palette.faint,
      this.options.dashes ? [3, 3] : [],
    );
    if (!this.options.dashes) ctx.globalAlpha = 0.55;
    pass(
      (e) => state.edgeOn[e] === 1 && styles[e]?.style === 'could',
      palette.muted,
      this.options.dashes ? [4, 4] : [],
    );
    ctx.globalAlpha = 1;
    pass((e) => state.edgeOn[e] === 1 && styles[e]?.style === 'used', palette.ink, []);
    ctx.setLineDash([]);

    // Nodes: absent ones as one faint batch, present ones batched by kind.
    const n = this.network.nodes.length;
    const r = 5;
    if (!this.options.cache) ctx.beginPath();
    for (let i = 0; i < n && !this.options.cache; i++) {
      if ((state.nodeDegree[i] ?? 0) > 0) continue;
      ctx.roundRect(pos.x[i] ?? 0, (pos.y[i] ?? 0) - NODE_H / 2, NODE_W, NODE_H, r);
    }
    if (!this.options.cache) {
      ctx.fillStyle = palette.ground;
      ctx.fill();
      ctx.strokeStyle = palette.faint;
      ctx.stroke();
    }
    let present = 0;
    for (let kind = 0; kind < KINDS.length; kind++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (this.kindOf[i] !== kind || (state.nodeDegree[i] ?? 0) === 0) continue;
        ctx.roundRect(pos.x[i] ?? 0, (pos.y[i] ?? 0) - NODE_H / 2, NODE_W, NODE_H, r);
        present++;
      }
      if (!this.options.cache) {
        ctx.fillStyle = palette.ground;
        ctx.fill();
      }
      ctx.strokeStyle = palette.kind[KINDS[kind] ?? 'device'];
      ctx.stroke();
    }

    // Labels only when they are readable (>= 7 CSS px): level of detail.
    let labels = 0;
    const fontPx = 12;
    if (!this.options.cache && fontPx * view.scale >= 7) {
      ctx.font = `${String(fontPx)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const x0 = view.originX;
      const y0 = view.originY;
      const x1 = x0 + this.cssW / view.scale;
      const y1 = y0 + this.cssH / view.scale;
      for (let i = 0; i < n; i++) {
        const x = pos.x[i] ?? 0;
        const y = pos.y[i] ?? 0;
        if (x + NODE_W < x0 || x > x1 || y < y0 || y > y1) continue;
        ctx.fillStyle = (state.nodeDegree[i] ?? 0) > 0 ? palette.ink : palette.muted;
        ctx.fillText(this.network.nodes[i]?.label ?? '', x + 10, y, NODE_W - 16);
        labels++;
      }
    }

    for (const [i, width] of [
      [selected, 2.5],
      [focus, 2],
    ] as const) {
      if (i === undefined) continue;
      ctx.lineWidth = width / view.scale;
      ctx.strokeStyle = palette.ink;
      ctx.beginPath();
      ctx.roundRect(
        (pos.x[i] ?? 0) - 3,
        (pos.y[i] ?? 0) - NODE_H / 2 - 3,
        NODE_W + 6,
        NODE_H + 6,
        r + 2,
      );
      ctx.stroke();
    }
    // Measurement only: reading a pixel back forces the raster to finish, so
    // the caller's timer covers the drawing and not just the recording of it.
    if (flush) ctx.getImageData(0, 0, 1, 1);
    return { edges: drawnEdges, nodes: present, labels };
  }
}
