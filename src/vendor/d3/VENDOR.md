# Vendored d3 modules

Copied verbatim from the npm tarballs below, `src/` only, with one change:
the bare imports between them (`d3-quadtree`, `d3-dispatch`, `d3-timer`) are
rewritten to relative paths so nothing resolves through `node_modules`.
Every file still runs on the origin that holds an owner's token, so a
version moves only by a reviewed diff of this directory (RDR-093, SPEC-189).

| Module | Version | Tarball SHA-256 | Licence |
|---|---|---|---|
| d3-force | 3.0.0 | `deacfa7ecb466f88717fe1863347dd65e5a5422d9f8c893d771cb2a7f987fa15` | ISC |
| d3-dispatch | 3.0.1 | `3d1a0b5c003e0e9608ad57f6ca21a0c8368031fcbe5f5317fe4e50b3f797ea23` | ISC |
| d3-quadtree | 3.0.1 | `d4145e9cecca8a6077e1099de96375ec9923b0de0df4004bd98aafa17c2d557f` | ISC |
| d3-timer | 3.0.1 | `05cdf901e1876a7f24f4c365a879252752e22e3cc52b131ca616639f07e8ed05` | ISC |

## Why not the 2026-11-03 releases

d3-force 3.0.1, d3-dispatch 3.0.2 and d3-timer 3.0.2 were published on
2026-11-03 after five years, by GitHub Actions with SLSA provenance
(`_npmUser` "GitHub Actions <npm-oidc-no-reply@github.com>"). Read on
2026-11-08: they no longer ship `src/`, only a Rollup build in `dist/`; the
build keeps the three d3 imports external, and a grep finds no network,
storage, `eval`/`Function`, `document` or `navigator` use. The change is a
toolchain move (mocha/eslint 7 to vitest/eslint 10, rollup 2 to 4), not a
behaviour change that matters here. They are not vendored because a
reviewable source tree is the point of vendoring; the last versions that
ship one are the ones above.
