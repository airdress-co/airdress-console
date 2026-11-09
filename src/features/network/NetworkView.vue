<script setup lang="ts">
// The network area (SPEC-189, proof of concept): the operator's people,
// identities and keys, devices, sessions and hosts over a window, in every
// arrangement (Columns, Groups, Free; Focus on a node), a replay, the
// selection's associations and an as-of table with a CSV export.
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AreaFrame from '@/components/AreaFrame.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import NetworkCanvas from './NetworkCanvas.vue';
import { HttpError } from '@/api/errors.ts';
import { useNetwork, useNetworkSwitch, windowOf } from './api.ts';
import type { WindowName } from './api.ts';
import { layout, PRESETS } from './layout.ts';
import type { Positions, Preset } from './layout.ts';

const { t, locale } = useI18n();
const windowName = ref<WindowName>('week');
const openedAt = Date.now();
const window = computed(() => windowOf(windowName.value, openedAt));
const query = useNetwork(window);
const toggle = useNetworkSwitch();
/** The view is off (403 not_enabled): the owner turns it on here (FR-46). */
const switchedOff = computed(
  () => query.error.value instanceof HttpError && query.error.value.code === 'not_enabled',
);
const preset = ref<Preset>('groups');
const view = ref<'graph' | 'table'>('graph');
const canvas = useTemplateRef<InstanceType<typeof NetworkCanvas>>('canvas');
const selected = ref<number | undefined>(undefined);
const playhead = ref<number | undefined>(undefined);

// Positions are anchored across window and arrangement changes within the
// same arrangement: a node keeps its place (SPEC-189 FR-13b).
const anchors = new Map<Preset, Positions>();
const positions = shallowRef<Positions | undefined>(undefined);
watch(
  [() => query.data.value, preset],
  ([data, p]) => {
    if (data === undefined) return;
    const next = layout(data.network, anchors.get(p), p);
    anchors.set(p, next);
    positions.value = next;
    selected.value = undefined;
  },
  { immediate: true },
);

const read = computed(() => query.data.value);
const network = computed(() => read.value?.network);
const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmt = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? '—' : time.format(ms);
watch(locale, () => {
  /* the formatter follows the browser; the labels follow the locale */
});

const label = (id: string): string => network.value?.nodes.find((n) => n.id === id)?.label ?? id;

const selectedNode = computed(() =>
  selected.value === undefined ? undefined : network.value?.nodes[selected.value],
);
const selectedEdges = computed(() => {
  const n = selectedNode.value;
  if (n === undefined || network.value === undefined) return [];
  return network.value.edges.filter((e) => e.source === n.id || e.target === n.id);
});

/** Associations holding at the playhead (or at the window end before any replay). */
const asOf = computed(() => playhead.value ?? network.value?.to ?? 0);
const heldRows = computed(() => {
  const net = network.value;
  if (net === undefined) return [];
  const at = asOf.value;
  return net.edges
    .filter((e) => e.start <= at && (e.end === null || e.end > at))
    .map((e) => ({
      edge: e,
      name: read.value?.association.get(e.id)?.name ?? '',
      backfilled: read.value?.association.get(e.id)?.backfilled ?? false,
    }));
});

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

function exportCsv(): void {
  const net = network.value;
  if (net === undefined) return;
  const header = [
    'subject',
    'association',
    'object',
    'from',
    'until',
    'closed_by',
    'reconstructed',
  ];
  const lines = net.edges.map((e) =>
    [
      label(e.source),
      read.value?.association.get(e.id)?.name ?? '',
      label(e.target),
      new Date(e.start).toISOString(),
      e.end === null ? '' : new Date(e.end).toISOString(),
      e.closedBy ?? '',
      String(read.value?.association.get(e.id)?.backfilled ?? false),
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `network-${window.value.from.slice(0, 10)}-${window.value.to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function focusSelected(): void {
  if (selected.value !== undefined) canvas.value?.focusOn(selected.value);
}
</script>

<template>
  <AreaFrame area="network">
    <p class="hint">{{ t('network.lead') }}</p>
    <div class="toolbar">
      <label>
        {{ t('network.window') }}
        <select v-model="windowName">
          <option value="day">{{ t('network.day') }}</option>
          <option value="week">{{ t('network.week') }}</option>
          <option value="month">{{ t('network.month') }}</option>
        </select>
      </label>
      <div class="segmented" role="group" :aria-label="t('network.arrangement')">
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          :aria-pressed="preset === p"
          @click="preset = p"
        >
          {{ t(`network.${p}`) }}
        </button>
      </div>
      <div class="segmented" role="group">
        <button type="button" :aria-pressed="view === 'graph'" @click="view = 'graph'">
          {{ t('network.graph') }}
        </button>
        <button type="button" :aria-pressed="view === 'table'" @click="view = 'table'">
          {{ t('network.table') }}
        </button>
      </div>
      <button type="button" :disabled="network === undefined" @click="exportCsv">
        {{ t('network.export') }}
      </button>
    </div>

    <section v-if="switchedOff" class="off">
      <p>{{ t('network.off') }}</p>
      <button type="button" :disabled="toggle.isPending.value" @click="toggle.mutate(true)">
        {{ t('network.turnOn') }}
      </button>
      <ErrorNotice v-if="toggle.error.value !== null" :error="toggle.error.value" />
    </section>
    <ErrorNotice v-else-if="query.error.value !== null" :error="query.error.value" />
    <p v-else-if="query.isPending.value">{{ t('common.loading') }}</p>
    <template v-else-if="network !== undefined && positions !== undefined">
      <p class="hint">
        {{
          t('network.summary', {
            nodes: network.nodes.length,
            intervals: network.edges.length,
            events: network.events.length,
          })
        }}
        <template v-if="read?.eventsFrom !== undefined && read.eventsFrom > network.from">
          {{ t('network.coverage', { from: fmt(read.eventsFrom) }) }}
        </template>
        <template v-if="read?.eventsTruncated">{{ t('network.truncated') }}</template>
        <template v-if="read?.historyStartsAt !== undefined">
          {{ ' ' + t('network.since', { time: fmt(read.historyStartsAt) }) }}
        </template>
      </p>
      <p v-if="network.nodes.length === 0">{{ t('network.empty') }}</p>
      <div v-else class="body" :class="{ hidden: view !== 'graph' }">
        <NetworkCanvas
          ref="canvas"
          :key="`${preset}:${window.from}`"
          class="graph"
          :network="network"
          :positions="positions"
          @select="(i) => (selected = i)"
          @time="(at) => (playhead = at)"
        />
        <aside class="panel" :aria-label="t('network.selected')">
          <template v-if="selectedNode !== undefined">
            <p class="kind">{{ t(`network.kind.${selectedNode.kind}`) }}</p>
            <h2>{{ selectedNode.label }}</h2>
            <button type="button" @click="focusSelected">{{ t('network.focus') }}</button>
            <h3>{{ t('network.associations') }}</h3>
            <ul class="assoc">
              <li v-for="e in selectedEdges" :key="e.id">
                <strong>{{ read?.association.get(e.id)?.name }}</strong>
                {{ e.source === selectedNode.id ? label(e.target) : label(e.source) }}
                <span class="hint">
                  {{ fmt(e.start) }} – {{ e.end === null ? t('network.open') : fmt(e.end) }}
                  <template v-if="e.closedBy">({{ t(`network.closed.${e.closedBy}`) }})</template>
                </span>
              </li>
            </ul>
          </template>
          <p v-else class="hint">{{ t('network.noneSelected') }}</p>
        </aside>
      </div>
      <section v-if="view === 'table'" class="table">
        <p class="hint">{{ t('network.asOf', { time: fmt(asOf), count: heldRows.length }) }}</p>
        <table>
          <thead>
            <tr>
              <th scope="col">{{ t('network.subject') }}</th>
              <th scope="col">{{ t('network.association') }}</th>
              <th scope="col">{{ t('network.object') }}</th>
              <th scope="col">{{ t('network.from') }}</th>
              <th scope="col">{{ t('network.until') }}</th>
              <th scope="col">{{ t('network.closedBy') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in heldRows" :key="row.edge.id">
              <td>{{ label(row.edge.source) }}</td>
              <td>
                {{ row.name }}
                <span v-if="row.backfilled" class="hint">· {{ t('network.reconstructed') }}</span>
              </td>
              <td>{{ label(row.edge.target) }}</td>
              <td>{{ fmt(row.edge.start) }}</td>
              <td>{{ row.edge.end === null ? t('network.open') : fmt(row.edge.end) }}</td>
              <td>
                {{ row.edge.closedBy === null ? '—' : t(`network.closed.${row.edge.closedBy}`) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </AreaFrame>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}
.segmented {
  display: inline-flex;
  gap: 0;
}
.segmented button[aria-pressed='true'] {
  font-weight: 600;
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
}
.body.hidden {
  display: none;
}
.panel {
  border: 1px solid var(--border, #d5dbe1);
  border-radius: 12px;
  padding: 16px;
}
.panel .kind {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.panel h2 {
  margin: 4px 0 8px;
  font-size: 18px;
}
.assoc {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 8px;
}
.assoc .hint {
  display: block;
}
</style>
