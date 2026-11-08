// Spike page H: the Canvas 2D renderer (SPEC-189 189-0.2). Playwright drives
// it through window.__spike.
import { createApp, h, ref } from 'vue';
import NetworkCanvas from '@/features/network/NetworkCanvas.vue';
import type { DrawStats } from '@/features/network/scene.ts';
import { focusLayout } from '@/features/network/layout.ts';
import {
  crossings,
  frameClock,
  overlaps2d,
  setup,
  stability,
  summary,
  violations,
} from './shared.ts';

type Canvas = InstanceType<typeof NetworkCanvas>;

const s = setup();
const graph = ref<Canvas | null>(null);
let draws: number[] = [];
let last: DrawStats = { edges: 0, nodes: 0, labels: 0 };

createApp({
  render: () =>
    h(NetworkCanvas, {
      ref: graph,
      network: s.network,
      positions: s.positions,
      flush: new URLSearchParams(location.search).get('flush') === '1',
      options: {
        cache: (new URLSearchParams(location.search).get('opt') ?? '').includes('cache'),
        dashes: !(new URLSearchParams(location.search).get('opt') ?? '').includes('nodash'),
      },
      onFrame: (ms: number, stats: DrawStats) => {
        draws.push(ms);
        last = stats;
      },
    }),
}).mount('#app');

function canvasOf(): Canvas {
  if (graph.value === null) throw new Error('not mounted');
  return graph.value;
}

Object.assign(window, {
  __spike: {
    n: s.n,
    edges: s.network.edges.length,
    events: s.network.events.length,
    layoutMs: Math.round(s.layoutMs),
    hash: s.hash,
    violations,
    preset: s.preset,
    stability: () => stability(s.seed, s.n, s.preset),
    quality: () => ({
      overlaps: s.preset === 'columns' ? null : overlaps2d(s.positions),
      crossings: s.n <= 1000 ? crossings(s.network, s.positions) : null,
    }),
    /** Time to lay out Focus around the busiest device, and enter it. */
    focus: () => {
      let best = 0;
      let busiest = 0;
      const degree = new Map<string, number>();
      for (const e of s.network.edges) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      }
      s.network.nodes.forEach((n, i) => {
        const d = degree.get(n.id) ?? 0;
        if (n.kind === 'device' && d > best) {
          best = d;
          busiest = i;
        }
      });
      const started = performance.now();
      const f = focusLayout(s.network, s.positions, busiest);
      const ms = performance.now() - started;
      canvasOf().focusOn(busiest);
      return {
        ms: Math.round(ms * 10) / 10,
        ring1: f.hop.filter((h) => h === 1).length,
        ring2: f.hop.filter((h) => h === 2).length,
      };
    },
    /** Play the whole window in `ms`, at the given zoom (undefined = fit). */
    replay: async (ms: number, scale?: number) => {
      const c = canvasOf();
      c.refit();
      if (scale !== undefined) c.zoomTo(scale);
      c.setTime(s.network.from);
      draws = [];
      const clock = frameClock();
      await c.play(ms);
      const raf = clock.stop();
      return { draw: summary(draws), frame: summary(raf), last };
    },
    exportPng: async () => {
      const blob = await canvasOf().exportPng();
      if (blob === null) return null;
      const bitmap = await createImageBitmap(blob);
      return { bytes: blob.size, width: bitmap.width, height: bitmap.height };
    },
    retheme: () => {
      canvasOf().retheme();
    },
  },
});
