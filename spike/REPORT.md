# Renderer spike for the network view (SPEC-189 189-0.2, RDR-093 §7.5)

Measured 2026-11-08 on the workstation (x86_64, Ubuntu 26.04, a 120 Hz
display, so a frame is 8.3 ms when the GPU keeps up). Playwright 1.64.1:
Chromium 1228-era build, Firefox 1555, WebKit 2370 (WPE MiniBrowser, **not**
Safari). Fixture: seed 7, 300 nodes, 1,500 edges, 5,000 events over 30 days.
"Headless" runs use software raster; "headed" runs use the GPU. Raw numbers:
`spike/results/*.json`; rerun everything with `sh spike/run-all.sh`.

H is the decided renderer (own Canvas 2D + vendored d3-force). A is
Cytoscape.js 3.34.4 on `preset` positions from the same layout. "Frame" is
the requestAnimationFrame interval during a 30-second replay of the whole
window (what a person sees); "draw" is the time inside our draw call.

## Verdict (item 10)

**H is confirmed**, with three conditions:

1. The static layer (node boxes and labels drawn once per view into a second
   canvas) is on by default, and standing ("could") edges are drawn only
   around the selection, as the Figma design already says. Drawing every
   standing edge dashed is what costs frames on software raster.
2. Positions are anchored: a node keeps the place it was first given, across
   window moves and growth. Without that, a relayout moves shared nodes by
   580–660 px on average.
3. Safari is measured on the owner's Mac before 189-D ships: the only WebKit
   here is WPE on Linux, which fails headed for both renderers' class of work.

| Rule                                  | Result                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame p95 < 16 ms at the fixture size | **Pass on GPU**: Chromium headed 8.4 ms in every variant; Firefox headed 9.1 ms with the static layer (25.2 ms without). **Fail** on WebKit/WPE headed (38–46 ms) and on software raster without the levers (Chromium headless 33.3 ms; 16.7 ms with both levers) |
| Zero CSP violations                   | **Pass**: 0 in Chromium, Firefox and WebKit across load, replay, theme switch, export and keyboard use                                                                                                                                                            |
| Under 2,500 lines                     | **Pass**: 976 lines in `src/features/network` without the fixture (scene 303, component 364, layout 163, replay 104, model 42)                                                                                                                                    |

## The ten items

1. **Bundle.** The lazy `/network` chunk is 10.2 KB gzip plus 0.4 KB CSS
   (fixture included; the real view reads the operator instead). The entry
   route is **not** byte-identical: Rolldown moves Vue's runtime-core into its
   own chunk, so the entry grows by about 0.75 KB gzip (78.9 → 79.6 KB). All
   assets: 114.3 KiB gzip, under the 200 KiB budget. The A page's Cytoscape
   chunk alone is 137 KB gzip.
2. **Module graph.** H adds no npm package to `bundle-packages.json`; the d3
   modules are vendored under `src/vendor/d3/` and show only as vendored.
   A adds `cytoscape`.
3. **CSP.** H: zero. A: exactly one in each engine, `style-src-elem inline`
   from the `<style id="__________cytoscape_stylesheet">` it injects
   (`.__________cytoscape_container { position: relative; }`, read from
   `dist/cytoscape.esm.mjs`). Either fix works from the source: pre-seed any
   element with that id (a same-origin `<link>`), or allow
   `'sha256-pgvDUBa4IjFA2yuSJ2cqcyxmNYJMborsd0ORcRv9vw8='`.
4. **Determinism and stability.** The layout hash is `f6acb9b8` in all three
   engines. That needed one change: d3's initial phyllotaxis uses `Math.cos`
   and `Math.sin`, so the layout sets initial positions itself. Mean
   displacement of shared nodes: +10% nodes 662.7 px, window moved by 5 days
   578.1 px; **anchored: 0 px for both, 0 overlapping boxes.** A final
   per-lane pass guarantees spacing; before it, the force layout left 290
   overlaps among 300 nodes.
5. **Frame cost and the WebGL threshold.** See the tables below. Heap after
   ten replays: 2.3 → 2.7 MiB, increments shrinking (not a clear leak).
   Unmount was not measured.
6. **Accessibility.** axe-core: 0 violations in all three engines. The
   keyboard walk (Tab into the listbox, arrows along lanes and associations,
   Enter, Escape) visits the same nodes in every engine; the scrubber moves
   one event per arrow and a page per PageUp; the live region reads e.g.
   "identity 24, present, 5 associations, at 12 Oct, 04:31". **Not done:**
   NVDA or VoiceOver.
7. **Export.** `canvas.toBlob` gives the backing store at the device pixel
   ratio: 1262×560 at DPR 1 (Chromium, Firefox), 2524×1120 at DPR 2 (WebKit),
   with no CSP event.
8. **Eval test.** H: no `eval(` or `Function(`. A: Cytoscape contains
   lodash's `Function("return this")()`, which `scripts/check-bundle.ts` does
   **not** catch (it matches only `new Function(`). Widen the pattern.
9. **d3 diff.** d3-force 3.0.1, d3-dispatch 3.0.2 and d3-timer 3.0.2 were
   published 2026-11-03 by GitHub Actions with SLSA provenance. They are a
   repackaging: `src/` is gone and only a Rollup `dist/` ships, with the three
   imports kept external and nothing suspicious in a grep. Vendored instead:
   the last versions that ship `src/` (see `src/vendor/d3/VENDOR.md`).
10. **Decision rule.** Above.

### Frame p95 (ms), 300 / 1,000 / 3,000 nodes, headed (GPU)

| Variant      | Chromium         | Firefox             | WebKit (WPE)   |
| ------------ | ---------------- | ------------------- | -------------- |
| plain        | 8.4 / 8.4 / 33.3 | 25.2 / 91.6 / 316.9 | 46 / 120 / 377 |
| no dashes    | 8.4 / 8.4 / 8.4  | 17.1 / 66.0 / 316.3 | 39 / 125 / 545 |
| static layer | 8.4 / 8.4 / 33.3 | 9.1 / 83.8 / 316.9  | 44 / 120 / 384 |
| both         | 8.4 / 8.4 / 8.4  | 17.1 / 58.5 / 333.0 | 38 / 123 / 545 |

Headless (software raster), 300 nodes: Chromium plain 33.3, both levers
16.7; Firefox plain 33.1; WebKit plain 17 (DPR 2). Cytoscape holds 16.7–17
headless in all three, because it caches textures and redraws only what
changed; that is what the static layer imitates.

### Where the WebGL backend starts to pay (Chromium, headed, both levers)

| Nodes / edges    | Layout (main thread) | Frame p95 |
| ---------------- | -------------------- | --------- |
| 300 / 1,500      | 0.11 s               | 8.4 ms    |
| 1,000 / 5,000    | 0.57 s               | 8.4 ms    |
| 3,000 / 15,000   | 2.1 s                | 8.4 ms    |
| 10,000 / 50,000  | 10.5 s               | 8.4 ms    |
| 20,000 / 100,000 | (not timed)          | 16.8 ms   |
| 30,000 / 150,000 | 48.9 s               | 25.0 ms   |

**Threshold:** build the WebGL backend (189-D.12) when a measured airdress
shows a window above **10,000 nodes or 50,000 edges**, or the draw call's
p95 exceeds **8 ms** in the field. But layout binds first: it takes 2.1 s at
3,000 nodes and 10.5 s at 10,000, on the main thread. Above roughly 1,000
nodes per window, the work to do is layout (a worker, or positions persisted
with the history, which anchoring needs anyway), not WebGL.

## What changed in the code because of the spike

- `layout.ts`: own initial positions (determinism), x pinned to the lane, a
  spacing pass per lane, anchors.
- `scene.ts`: the static layer and the undashed option (`SceneOptions`).
- `NetworkCanvas.vue`: props destructured and derived state in `computed`
  (the console's lint rules), a `frame` event instead of a callback prop.
- `playwright.spike.config.ts`: WebKit 2370 also needs `libavif16`,
  `libgav1-1` and `libyuv0`; unpacked privately like `e2e/webkit-libs.sh`.
  The console's own e2e will hit the same thing when it moves to WebKit 2370.

## Addendum, 2026-11-09: every arrangement, decided late (RDR-095)

The owner asked to build all of RDR-095's arrangements and choose the default
late. They are one seeded, timer-less layout with different forces
(`layout(network, anchors, preset)`), plus Focus (`focusLayout`), all drawn by
the same Canvas 2D scene:

- **Columns**: the lanes measured above (boxes, bezier edges).
- **Groups**: soft lane bands (`forceX` 0.18 toward the kind's band), a pull
  toward each person's centroid, links into shared hosts weak (0.03) so the
  clusters do not collapse onto them; person halos; glyphs per kind
  (RDR-095 §7.2), straight edges.
- **Free**: Groups without the bands: people become islands around the
  shared hosts.
- **Focus** (`f` on a node, Escape back): the selection at the centre, rings
  at one and two associations, the rest dimmed; a separate layout, the base
  map untouched.

Two fixtures: `household` (people with one identity and 2–5 devices, short
sessions on a few shared hosts), used for judging the look, and `random`
(random endpoints), the performance worst case. Screenshots:
`results/look-{columns,groups,free,focus}-{60,300}.png` (household,
Chromium). Raw numbers: `results/*-presets-*.json`.

### Numbers (household fixture unless stated; Chromium / Firefox / WebKit)

|                                                                | Columns              | Groups               | Free                 |
| -------------------------------------------------------------- | -------------------- | -------------------- | -------------------- |
| Layout, 300 nodes                                              | 94 / 162 / 197 ms    | 235 / 375 / 329 ms   | 217 / 360 / 316 ms   |
| Layout, 1,000 nodes                                            | 0.42 / 0.69 / 0.72 s | 1.02 / 1.60 / 1.28 s | 0.98 / 1.57 / 1.22 s |
| Layout, 3,000 nodes                                            | 1.7 / 2.5 / 2.6 s    | 3.7 / 5.8 / 4.7 s    | 3.4 / 5.5 / 4.5 s    |
| Same layout in all three engines                               | yes                  | yes                  | yes                  |
| Edge crossings, 300 nodes                                      | 8,866                | 5,082                | 3,178                |
| Overlapping glyphs, 300 nodes                                  | 0 (boxes)            | 0                    | 0                    |
| Shared nodes moved, +10% / window +5 days, no anchors (random) | 663 / 578 px         | 190 / 146 px         | 212 / 201 px         |
| The same, anchored                                             | 0 / 0 px             | 0 / 0 px             | 0 / 0 px             |
| New-on-old overlaps when anchored (random, ~330 nodes)         | 0                    | 42                   | 19                   |
| Frame p95 on the GPU, 300–3,000 nodes                          | 8.4 / 9.1 ms         | 8.4 / 9.1 ms         | 8.4 / 9.1 ms         |
| Focus layout, 300–3,000 nodes                                  | 0.2–1.9 ms           |                      |                      |

Crossings count each edge as a straight segment (Columns' beziers counted
straight), so they compare the presets, not absolute legibility.

### What this says

- **Rendering does not choose for us.** Every preset holds the GPU frame
  budget at every size measured; the choice is about reading, not cost.
- **Layout cost does, above 1,000 nodes.** The force presets cost 2.2–3x
  Columns and pass a second at 1,000 nodes on the main thread; SPEC-189
  189-D.16 (layout off the main thread, or positions persisted) now applies
  to them first.
- **Anchoring is enough for stability in every preset** (0 px), but the
  force presets need a final nudge so new nodes do not land on anchored ones
  (the lane pass does that for Columns).
- **Free crosses least** (3,178 against Columns' 8,866 at 300 nodes) and
  reads as islands per person; Columns is the most legible for a small
  household; Groups sits between, with the people as bands.
- **Focus is effectively free** (under 2 ms at 3,000 nodes).
- Not built: the person-badge collapse of RDR-095 §7.5's dense tier, label
  collision handling inside a cluster, and tweened transitions between
  arrangements.
