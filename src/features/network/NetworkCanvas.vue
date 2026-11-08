<script setup lang="ts">
// The network graph on a Canvas 2D (SPEC-189 D-1), with the accessible layer
// a canvas needs (FR-21a): a focusable listbox whose options mirror the nodes,
// arrow keys that walk lanes and associations, and a live region. Spike
// version: strings are English only; the view's i18n comes with 189-D.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { Positions } from './layout.ts';
import type { Network } from './model.ts';
import { Replay } from './replay.ts';
import type { State } from './replay.ts';
import { readPalette, Scene } from './scene.ts';
import type { DrawStats, SceneOptions, View } from './scene.ts';

const {
  network,
  positions,
  flush,
  options = { cache: true, dashes: false },
} = defineProps<{
  network: Network;
  positions: Positions;
  /** Measurement only (the spike): finish the raster inside the timed draw. */
  flush?: boolean;
  /** Renderer levers (189-0.2). The default is what the spike recommends. */
  options?: SceneOptions;
}>();
const emit = defineEmits<{ frame: [drawMs: number, stats: DrawStats] }>();

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const box = useTemplateRef<HTMLDivElement>('box');
const scene = shallowRef<Scene | undefined>(undefined);
const replay = computed(() => new Replay(network, positions.index));
const t = ref(0);
const state = shallowRef<State | undefined>(undefined);
const focus = ref<number | undefined>(undefined);
const selected = ref<number | undefined>(undefined);
const playing = ref(false);
let view: View = { scale: 1, originX: 0, originY: 0 };
let raf = 0;
let resizeObserver: ResizeObserver | undefined;

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});
const timeLabel = computed(() => timeFormat.format(t.value));
const eventStep = computed(() => Math.max(0, state.value?.eventIndex ?? 0));

// Lanes sorted by y, and edges per node by direction, for the keyboard walk.
const nav = computed(() => {
  const laneOf = new Map<string, number[]>();
  network.nodes.forEach((n, i) => {
    const lane = laneOf.get(n.kind) ?? [];
    lane.push(i);
    laneOf.set(n.kind, lane);
  });
  for (const lane of laneOf.values()) {
    lane.sort((a, b) => (positions.y[a] ?? 0) - (positions.y[b] ?? 0));
  }
  const right: number[][] = Array.from({ length: network.nodes.length }, () => []);
  const left: number[][] = Array.from({ length: network.nodes.length }, () => []);
  network.edges.forEach((e, i) => {
    right[positions.index.get(e.source) ?? 0]?.push(i);
    left[positions.index.get(e.target) ?? 0]?.push(i);
  });
  return { laneOf, right, left };
});

function draw(): void {
  const s = scene.value;
  if (s === undefined || state.value === undefined) return;
  const started = performance.now();
  const stats = s.draw(state.value, view, focus.value, selected.value, flush);
  emit('frame', performance.now() - started, stats);
}

function setTime(next: number): void {
  t.value = Math.min(Math.max(next, network.from), network.to);
  state.value = replay.value.at(t.value);
  draw();
}

function play(durationMs = 30_000): Promise<void> {
  stop();
  playing.value = true;
  const from = t.value >= network.to ? network.from : t.value;
  const span = network.to - from;
  const started = performance.now();
  return new Promise((resolve) => {
    const frame = (now: number): void => {
      const p = Math.min(1, (now - started) / durationMs);
      setTime(from + p * span);
      if (p < 1 && playing.value) raf = requestAnimationFrame(frame);
      else {
        playing.value = false;
        resolve();
      }
    };
    raf = requestAnimationFrame(frame);
  });
}

function stop(): void {
  cancelAnimationFrame(raf);
  playing.value = false;
}

function onScrub(event: Event): void {
  const i = Number((event.target as HTMLInputElement).value);
  const e = network.events[i];
  if (e !== undefined) setTime(e.t);
}

function describe(i: number): string {
  const node = network.nodes[i];
  if (node === undefined) return '';
  const degree = state.value?.nodeDegree[i] ?? 0;
  const presence = degree > 0 ? `present, ${String(degree)} associations` : 'not present';
  return `${node.label}, ${presence}, at ${timeLabel.value}`;
}
const announcement = computed(() => (focus.value === undefined ? '' : describe(focus.value)));

function nearestByY(candidates: readonly number[], y: number): number | undefined {
  let best: number | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.abs((positions.y[c] ?? 0) - y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function across(i: number, edges: readonly number[], end: 'source' | 'target'): number | undefined {
  const holding = edges.filter((e) => state.value?.edgeOn[e] === 1);
  const ends = (holding.length > 0 ? holding : edges).map(
    (e) => positions.index.get(network.edges[e]?.[end] ?? '') ?? 0,
  );
  return nearestByY(ends, positions.y[i] ?? 0);
}

function onKey(event: KeyboardEvent): void {
  const i = focus.value ?? 0;
  const node = network.nodes[i];
  const lane = node === undefined ? [] : (nav.value.laneOf.get(node.kind) ?? []);
  const at = lane.indexOf(i);
  let next: number | undefined;
  switch (event.key) {
    case 'ArrowDown':
      next = lane[Math.min(lane.length - 1, at + 1)];
      break;
    case 'ArrowUp':
      next = lane[Math.max(0, at - 1)];
      break;
    case 'ArrowRight':
      next = across(i, nav.value.right[i] ?? [], 'target');
      break;
    case 'ArrowLeft':
      next = across(i, nav.value.left[i] ?? [], 'source');
      break;
    case 'Enter':
      selected.value = focus.value;
      draw();
      event.preventDefault();
      return;
    case 'Escape':
      selected.value = undefined;
      draw();
      return;
    default:
      return;
  }
  event.preventDefault();
  if (next !== undefined) {
    focus.value = next;
    draw();
  }
}

function onGraphFocus(): void {
  focus.value ??= nav.value.laneOf.get('person')?.[0] ?? 0;
  draw();
}

function onClick(event: MouseEvent): void {
  const s = scene.value;
  if (s === undefined || canvas.value === null) return;
  const rect = canvas.value.getBoundingClientRect();
  selected.value = s.hit(view, event.clientX - rect.left, event.clientY - rect.top);
  if (selected.value !== undefined) focus.value = selected.value;
  draw();
}

function onWheel(event: WheelEvent): void {
  if (canvas.value === null) return;
  event.preventDefault();
  const rect = canvas.value.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const lx = view.originX + px / view.scale;
  const ly = view.originY + py / view.scale;
  const scale = Math.min(4, Math.max(0.02, view.scale * Math.exp(-event.deltaY / 500)));
  view = { scale, originX: lx - px / scale, originY: ly - py / scale };
  draw();
}

function exportPng(): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (canvas.value === null) resolve(null);
    else canvas.value.toBlob(resolve, 'image/png');
  });
}

function refit(): void {
  const s = scene.value;
  const el = box.value;
  if (s === undefined || el === null) return;
  s.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio);
  view = s.fit();
  draw();
}

function zoomTo(scale: number): void {
  view = { ...view, scale };
  draw();
}

onMounted(() => {
  setTime(network.from);
  if (canvas.value === null || box.value === null) return;
  scene.value = new Scene(canvas.value, network, positions, readPalette(box.value), options);
  refit();
  resizeObserver = new ResizeObserver(refit);
  resizeObserver.observe(box.value);
});

onBeforeUnmount(() => {
  stop();
  resizeObserver?.disconnect();
});

watch(selected, () => {
  draw();
});

function retheme(): void {
  if (box.value !== null) scene.value?.setPalette(readPalette(box.value));
  draw();
}

defineExpose({ setTime, play, stop, exportPng, refit, zoomTo, draw, retheme });
</script>

<template>
  <section class="network" aria-label="Network">
    <div ref="box" class="stage">
      <canvas
        ref="canvas"
        class="canvas"
        role="img"
        :aria-label="`Network at ${timeLabel}: ${String(network.nodes.length)} nodes in the window`"
        @click="onClick"
        @wheel="onWheel"
      />
    </div>
    <div
      class="proxies"
      role="listbox"
      tabindex="0"
      aria-label="Nodes. Up and down move within a lane, left and right follow an association."
      :aria-activedescendant="focus === undefined ? undefined : `net-node-${String(focus)}`"
      @focus="onGraphFocus"
      @keydown="onKey"
    >
      <div
        v-for="(node, i) in network.nodes"
        :id="`net-node-${String(i)}`"
        :key="node.id"
        role="option"
        :aria-selected="selected === i"
      >
        {{ node.kind }} {{ node.label }}
      </div>
    </div>
    <div class="controls">
      <button v-if="!playing" type="button" @click="play()">Play</button>
      <button v-else type="button" @click="stop">Pause</button>
      <label class="scrub">
        <span class="visually-hidden">Time</span>
        <input
          type="range"
          min="0"
          :max="network.events.length - 1"
          :value="eventStep"
          :aria-valuetext="timeLabel"
          @input="onScrub"
        />
      </label>
      <output>{{ timeLabel }}</output>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>
.network {
  --net-ground: #ffffff;
  --net-ink: #141b24;
  --net-muted: #7a8694;
  --net-faint: #d5dbe1;
  display: grid;
  gap: 8px;
}
@media (prefers-color-scheme: dark) {
  .network {
    --net-ground: #1f1f1f;
    --net-ink: #f2efe8;
    --net-muted: #9aa4af;
    --net-faint: #3a3f45;
  }
}
.stage {
  height: 560px;
  border: 1px solid var(--net-faint);
  border-radius: 12px;
  overflow: hidden;
}
.canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.proxies {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.controls {
  display: flex;
  gap: 12px;
  align-items: center;
}
.scrub {
  flex: 1;
}
.scrub input {
  width: 100%;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
