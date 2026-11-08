<script setup lang="ts">
// Spike wiring only (SPEC-189 189-0.2): the lazily loaded /network route with
// a seeded fixture, so the production build can be measured with the view in
// it. The real view reads the operator (189-C) and lives in AreaFrame (189-D).
import NetworkCanvas from './NetworkCanvas.vue';
import { fixture } from './fixture.ts';
import { layout } from './layout.ts';

const network = fixture(7, { nodes: 300 });
const positions = layout(network);
</script>

<template>
  <NetworkCanvas :network="network" :positions="positions" />
</template>
