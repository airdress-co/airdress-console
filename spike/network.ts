// Spike page H: the Canvas 2D renderer (SPEC-189 189-0.2). Playwright drives
// it through window.__spike.
import { createApp, h, ref } from 'vue';
import NetworkCanvas from '@/features/network/NetworkCanvas.vue';
import type { DrawStats } from '@/features/network/scene.ts';
import { frameClock, setup, stability, summary, violations } from './shared.ts';

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
    stability: () => stability(s.seed, s.n),
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
