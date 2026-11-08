// The Canvas 2D renderer (SPEC-189 D-1): draws the state at an instant over
// the window-wide layout. Paths are batched by style and colour, so the cost
// is a handful of stroke/fill calls plus one fillText per readable label.
// Hit-testing goes through a quadtree of node centres, built once.
import { quadtree } from '@/vendor/d3/d3-quadtree/index.js';
import type { Quadtree } from '@/vendor/d3/d3-quadtree/index.js';
import { NODE_H, NODE_W } from './layout.ts';
import type { Positions } from './layout.ts';

/** Focus positions carry the hop count from the selection (3 = the rest). */
export type ScenePositions = Positions & { readonly hop?: Uint8Array };
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
  private tree: Quadtree<number>;
  private readonly src: Uint32Array;
  private readonly dst: Uint32Array;
  private readonly kindOf: Uint8Array;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private layer: HTMLCanvasElement | undefined;
  private layerKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly network: Network,
    private pos: ScenePositions,
    private palette: Palette,
    private readonly options: SceneOptions = { cache: false, dashes: true },
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('no 2D context');
    this.ctx = ctx;
    this.src = Uint32Array.from(network.edges, (e) => pos.index.get(e.source) ?? 0);
    this.dst = Uint32Array.from(network.edges, (e) => pos.index.get(e.target) ?? 0);
    this.kindOf = Uint8Array.from(network.nodes, (n) => KINDS.indexOf(n.kind));
    this.tree = this.buildTree();
  }

  /** Columns draw boxes; the force presets and Focus draw glyphs (RDR-095 §7.2). */
  private get glyphs(): boolean {
    return this.pos.preset !== 'columns' || this.pos.hop !== undefined;
  }

  private buildTree(): Quadtree<number> {
    const { pos } = this;
    const dx = this.glyphs ? 0 : NODE_W / 2;
    return quadtree<number>()
      .x((i) => (pos.x[i] ?? 0) + dx)
      .y((i) => pos.y[i] ?? 0)
      .addAll(this.network.nodes.map((_, i) => i));
  }

  /** Switch arrangement or enter/leave Focus without remounting. */
  setPositions(pos: ScenePositions): void {
    this.pos = pos;
    this.tree = this.buildTree();
    this.layerKey = '';
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.layerKey = '';
  }

  /** Adds node i's outline to the current path. */
  private shape(ctx: CanvasRenderingContext2D, i: number): void {
    const x = this.pos.x[i] ?? 0;
    const y = this.pos.y[i] ?? 0;
    if (!this.glyphs) {
      ctx.roundRect(x, y - NODE_H / 2, NODE_W, NODE_H, 5);
      return;
    }
    switch (KINDS[this.kindOf[i] ?? 0]) {
      case 'person':
        ctx.moveTo(x + 13, y);
        ctx.arc(x, y, 13, 0, 2 * Math.PI);
        break;
      case 'identity':
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x, y + 7);
        ctx.lineTo(x - 7, y);
        ctx.closePath();
        break;
      case 'device':
        ctx.roundRect(x - 11, y - 8, 22, 16, 4);
        break;
      case 'session':
        ctx.roundRect(x - 8, y - 3.5, 16, 7, 3.5);
        break;
      case 'host':
      case undefined: {
        // host: a hexagon
        const r = 12;
        ctx.moveTo(x + r, y);
        for (let k = 1; k <= 6; k++) {
          ctx.lineTo(x + r * Math.cos((k * Math.PI) / 3), y + r * Math.sin((k * Math.PI) / 3));
        }
        ctx.closePath();
      }
    }
  }

  private halos(ctx: CanvasRenderingContext2D): void {
    if (!this.glyphs || this.pos.hop !== undefined) return;
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = this.palette.kind.person;
    ctx.beginPath();
    for (const h of this.pos.halos) {
      ctx.moveTo(h.x + h.r, h.y);
      ctx.arc(h.x, h.y, h.r, 0, 2 * Math.PI);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Labels by tier: always for people and hosts, others once readable. */
  private labels(ctx: CanvasRenderingContext2D, view: View, ink: (i: number) => string): number {
    const fontPx = this.glyphs ? 11 : 12;
    if (fontPx * view.scale < 7) return 0;
    ctx.font = `${String(fontPx)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const x0 = view.originX;
    const y0 = view.originY;
    const x1 = x0 + this.cssW / view.scale;
    const y1 = y0 + this.cssH / view.scale;
    let count = 0;
    for (let i = 0; i < this.network.nodes.length; i++) {
      const x = this.pos.x[i] ?? 0;
      const y = this.pos.y[i] ?? 0;
      if (x + NODE_W < x0 || x - NODE_W > x1 || y < y0 || y > y1) continue;
      const kind = KINDS[this.kindOf[i] ?? 0];
      // Density tiers (RDR-095 §7.5): above 60 nodes only people and hosts
      // are labelled until the person zooms in.
      const crowded = this.network.nodes.length > 60 && view.scale < 1.6;
      // Sessions are labelled only in the detail panel and on hover.
      if (this.glyphs && kind === 'session') continue;
      if (this.glyphs && kind !== 'person' && kind !== 'host' && (crowded || view.scale < 0.9))
        continue;
      ctx.fillStyle = ink(i);
      if (this.glyphs) ctx.fillText(this.network.nodes[i]?.label ?? '', x + 16, y, NODE_W);
      else ctx.fillText(this.network.nodes[i]?.label ?? '', x + 10, y, NODE_W - 16);
      count++;
    }
    return count;
  }

  /** The static layer: halos, every node's outline (absent style) and labels, for one view. */
  private staticLayer(view: View): HTMLCanvasElement {
    const key = `${this.pos.preset}|${String(this.pos.hop !== undefined)}|${String(view.scale)}|${String(view.originX)}|${String(view.originY)}|${String(this.canvas.width)}x${String(this.canvas.height)}`;
    if (this.layer !== undefined && key === this.layerKey) return this.layer;
    const layer = this.layer ?? document.createElement('canvas');
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('no 2D context');
    const { palette } = this;
    const k = view.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, layer.width, layer.height);
    ctx.setTransform(k, 0, 0, k, -view.originX * k, -view.originY * k);
    ctx.lineWidth = 1.25 / view.scale;
    this.halos(ctx);
    ctx.beginPath();
    for (let i = 0; i < this.network.nodes.length; i++) this.shape(ctx, i);
    ctx.strokeStyle = palette.faint;
    ctx.stroke();
    this.labels(ctx, view, () => palette.ink);
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
    this.layerKey = '';
  }

  /** The view that fits the whole layout, with a margin. */
  fit(): View {
    const margin = 24;
    const h = this.pos.bottom - this.pos.top + NODE_H;
    const w = this.pos.width + (this.glyphs ? NODE_W : 0);
    const scale = Math.min((this.cssW - 2 * margin) / w, (this.cssH - 2 * margin) / Math.max(h, 1));
    // Centre the drawing in whichever direction has room to spare.
    const spareX = this.cssW / scale - w - (2 * margin) / scale;
    const spareY = this.cssH / scale - h - (2 * margin) / scale;
    return {
      scale,
      originX: -margin / scale - Math.max(0, spareX) / 2,
      originY: this.pos.top - NODE_H / 2 - margin / scale - Math.max(0, spareY) / 2,
    };
  }

  /** The node under a canvas point (CSS pixels), if any. */
  hit(view: View, px: number, py: number): number | undefined {
    const lx = view.originX + px / view.scale;
    const ly = view.originY + py / view.scale;
    if (this.glyphs) return this.tree.find(lx, ly, 14 / Math.min(1, view.scale));
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
    const glyphs = this.glyphs;
    const hop = pos.hop;
    const k = view.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.options.cache) ctx.drawImage(this.staticLayer(view), 0, 0);
    else {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(k, 0, 0, k, -view.originX * k, -view.originY * k);
    ctx.lineWidth = 1.25 / view.scale;
    if (!this.options.cache) this.halos(ctx);

    // Edges, in three batches: ended (faint), standing (dashed), used (solid).
    // In Focus, an edge that touches the dimmed third ring is skipped.
    const edgeCount = this.network.edges.length;
    const styles = this.network.edges;
    let drawnEdges = 0;
    const pass = (pick: (e: number) => boolean, stroke: string, dash: readonly number[]): void => {
      ctx.beginPath();
      for (let e = 0; e < edgeCount; e++) {
        if (!pick(e)) continue;
        const a = src[e] ?? 0;
        const b = dst[e] ?? 0;
        if (hop !== undefined && ((hop[a] ?? 3) === 3 || (hop[b] ?? 3) === 3)) continue;
        const x2 = pos.x[b] ?? 0;
        const y2 = pos.y[b] ?? 0;
        const y1 = pos.y[a] ?? 0;
        if (glyphs) {
          ctx.moveTo(pos.x[a] ?? 0, y1);
          ctx.lineTo(x2, y2);
        } else {
          const x1 = (pos.x[a] ?? 0) + NODE_W;
          const mx = (x1 + x2) / 2;
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
        }
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
    if (!this.options.cache) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if ((state.nodeDegree[i] ?? 0) > 0) continue;
        this.shape(ctx, i);
      }
      ctx.fillStyle = palette.ground;
      ctx.fill();
      ctx.strokeStyle = palette.faint;
      ctx.stroke();
    }
    let present = 0;
    for (let kind = 0; kind < KINDS.length; kind++) {
      for (const dim of hop === undefined ? [false] : [false, true]) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (this.kindOf[i] !== kind || (state.nodeDegree[i] ?? 0) === 0) continue;
          if (hop !== undefined && ((hop[i] ?? 3) === 3) !== dim) continue;
          this.shape(ctx, i);
          present++;
        }
        ctx.globalAlpha = dim ? 0.25 : 1;
        const colour = palette.kind[KINDS[kind] ?? 'device'];
        if (glyphs) {
          ctx.fillStyle = colour;
          ctx.fill();
        } else if (!this.options.cache) {
          ctx.fillStyle = palette.ground;
          ctx.fill();
        }
        ctx.strokeStyle = colour;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    let labels = 0;
    if (!this.options.cache) {
      labels = this.labels(ctx, view, (i) =>
        (state.nodeDegree[i] ?? 0) > 0 && (hop?.[i] ?? 0) !== 3 ? palette.ink : palette.muted,
      );
    }

    for (const [i, width] of [
      [selected, 2.5],
      [focus, 2],
    ] as const) {
      if (i === undefined) continue;
      ctx.lineWidth = width / view.scale;
      ctx.strokeStyle = palette.ink;
      ctx.beginPath();
      if (glyphs) {
        ctx.arc(pos.x[i] ?? 0, pos.y[i] ?? 0, 18, 0, 2 * Math.PI);
      } else {
        ctx.roundRect(
          (pos.x[i] ?? 0) - 3,
          (pos.y[i] ?? 0) - NODE_H / 2 - 3,
          NODE_W + 6,
          NODE_H + 6,
          7,
        );
      }
      ctx.stroke();
    }
    // Measurement only: reading a pixel back forces the raster to finish, so
    // the caller's timer covers the drawing and not just the recording of it.
    if (flush) ctx.getImageData(0, 0, 1, 1);
    return { edges: drawnEdges, nodes: present, labels };
  }
}
