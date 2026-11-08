// Spike page A: Cytoscape.js on `preset` positions from the same layout
// (RDR-093 §7.5). Replay toggles classes on the elements whose state changed
// since the previous frame, inside one cy.batch().
import cytoscape from 'cytoscape';
import { NODE_H, NODE_W } from '@/features/network/layout.ts';
import { Replay } from '@/features/network/replay.ts';
import { frameClock, setup, stability, summary, violations } from './shared.ts';

const s = setup();
const app = document.getElementById('app');
if (app === null) throw new Error('no #app');
const box = document.createElement('div');
box.style.height = '560px';
app.appendChild(box);

const cy = cytoscape({
  container: box,
  elements: [
    ...s.network.nodes.map((node, i) => ({
      group: 'nodes' as const,
      data: { id: node.id, label: node.label, kind: node.kind },
      position: { x: (s.positions.x[i] ?? 0) + NODE_W / 2, y: s.positions.y[i] ?? 0 },
      classes: 'absent',
    })),
    ...s.network.edges.map((e) => ({
      group: 'edges' as const,
      data: { id: e.id, source: e.source, target: e.target },
      classes: `off ${e.style}`,
    })),
  ],
  layout: { name: 'preset' },
  style: [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: NODE_W,
        height: NODE_H,
        'background-color': '#ffffff',
        'border-width': 1.25,
        'border-color': '#4f86e8',
        label: 'data(label)',
        'font-size': 12,
        'text-valign': 'center',
      },
    },
    { selector: 'node.absent', style: { 'border-color': '#d5dbe1', color: '#7a8694' } },
    {
      selector: 'edge',
      style: { width: 1.25, 'curve-style': 'unbundled-bezier', 'line-color': '#141b24' },
    },
    { selector: 'edge.could', style: { 'line-style': 'dashed', 'line-color': '#7a8694' } },
    { selector: 'edge.off', style: { display: 'none' } },
  ],
  textureOnViewport: false,
});

const replay = new Replay(s.network, s.positions.index);
let prevEdge = new Uint8Array(s.network.edges.length);
let prevNode = new Uint32Array(s.network.nodes.length);

function setTime(t: number): void {
  const state = replay.at(t);
  cy.batch(() => {
    for (let e = 0; e < state.edgeOn.length; e++) {
      if (state.edgeOn[e] === prevEdge[e]) continue;
      const el = cy.getElementById(s.network.edges[e]?.id ?? '');
      if (state.edgeOn[e] === 1) el.removeClass('off');
      else el.addClass('off');
    }
    for (let i = 0; i < state.nodeDegree.length; i++) {
      const was = (prevNode[i] ?? 0) > 0;
      const is = (state.nodeDegree[i] ?? 0) > 0;
      if (was === is) continue;
      const el = cy.getElementById(s.network.nodes[i]?.id ?? '');
      if (is) el.removeClass('absent');
      else el.addClass('absent');
    }
  });
  prevEdge = state.edgeOn.slice();
  prevNode = state.nodeDegree.slice();
}

Object.assign(window, {
  __spike: {
    n: s.n,
    layoutMs: Math.round(s.layoutMs),
    hash: s.hash,
    violations,
    stability: () => stability(s.seed, s.n),
    replay: async (ms: number) => {
      cy.fit(undefined, 24);
      setTime(s.network.from);
      const updates: number[] = [];
      const clock = frameClock();
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const frame = (now: number): void => {
          const p = Math.min(1, (now - started) / ms);
          const t0 = performance.now();
          setTime(s.network.from + p * (s.network.to - s.network.from));
          updates.push(performance.now() - t0);
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return { draw: summary(updates), frame: summary(clock.stop()) };
    },
    exportPng: () => {
      const blob = cy.png({ output: 'blob', scale: 2 }) as unknown as Blob;
      return { bytes: blob.size };
    },
  },
});
