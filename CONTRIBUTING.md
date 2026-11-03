# Contributing

## Commits and pull requests

- Conventional commits (`feat(auth): …`, `fix(machines): …`); the
  `commit-msg` hook checks it. `release.yml` reads them to choose the next
  version and write the GitHub Release (see Releasing).
- Cite the spec task a commit works on (`184-D.8`) and, when it finishes
  one, add a `Tasks-done: 184-D.8` trailer.
- Install the hooks once per clone: `prek install`.
- Rebase onto `origin/main` to update a branch; never merge main into it.

## Dependencies

A new runtime dependency is a security decision, not a convenience: every
package in the bundle runs on the origin that holds an owner's operator
token. Add it to `bundle-allowlist.json` in the same pull request, with the
reason in the description. Development tools are not limited this way, but
are pinned exactly (`save-exact`) and installed without running scripts.

## Releasing (deliberate steps, never automatic)

Versions follow conventional commits (owner, 2026-11-03). There is one
mechanism, `.github/workflows/release.yml`, and nothing releases on a merge,
a tag push or a timer:

1. **Release.** `gh workflow run release.yml --repo airdress-co/airdress-console --ref main`
   (or `just console-release` in airdress-ops, which also follows the run).
   Add `-f dry_run=true` to see the version and notes without changing
   anything. The workflow, at the dispatched `main` commit:
   - computes the next version with git-cliff (`cliff.toml`) from the
     commits since the last `v*` tag: `feat` → minor, `fix` and `perf` →
     patch, `!` or a `BREAKING CHANGE` footer → major; **while 0.x a
     breaking change bumps the minor**, so leaving 0.x is a deliberate act.
     No tag yet → `v0.1.0`;
   - refuses when nothing releasable landed (`chore`, `docs`, `ci`, `test`,
     `style`, `refactor`, `build` alone make no release);
   - tags that commit `vX.Y.Z` (annotated), writes the GitHub Release with
     git-cliff's notes for exactly those commits, and dispatches
     `publish.yml` at the tag.
2. **Publish** (dispatched by step 1; by hand only to re-run a failed one:
   `just console-publish vX.Y.Z` in airdress-ops). It runs the checks,
   builds with `CONSOLE_VERSION=X.Y.Z`, and uploads to
   `gs://airdress-console-prod/v/X.Y.Z/`: hashed assets with
   `Cache-Control: public, max-age=31536000, immutable`, the documents with
   `no-cache`, the build's `index.html` last. It refuses a version that
   already exists, and its credential can only create objects under `v/`:
   a published version is never replaced.
3. **Promote** (a person, always): `just console-promote next vX.Y.Z` to
   try it, then `just console-promote stable vX.Y.Z` to make it the
   default. That writes `channels/<channel>.json`
   (`{"version":"X.Y.Z"}`, `max-age=60`) and, for `stable`, copies the
   release's entry document to the bucket root and to `/callback`. Rolling
   back is the same command with the previous version.

**The version lives in the tag, nowhere else.** No release commit is made to
`main` (it is protected and no bot writes to it): the build learns its
version from `CONSOLE_VERSION`, which `publish.yml` sets from the tag, and a
local build calls itself `0.0.0-dev`. `package.json`'s `version` stays
`0.0.0` and is never read or shown. **The changelog is the GitHub
Releases page**; there is no `CHANGELOG.md`.

`scripts/check-release-version.sh` checks the bump rules offline against a
throwaway repository (CI runs it when `cliff.toml`, the release workflows or
those scripts change). git-cliff is pinned by version and SHA-512 in
`scripts/install-git-cliff.sh`.

Every published version stays loadable at `/v/X.Y.Z/`, so a person can open
an older build while a problem is fixed. Runbook: airdress-ops RB-103.

## The entry document

`entry/` is a separate, tiny build (`vite.entry.config.ts`, output
`dist/_entry/`), served at the bucket root and at `/callback`. It is the
only thing that is not under `/v/`:

- At `/`: reads `?channel=stable|next` (remembered in `localStorage` as
  `airdress.console.channel`), else the remembered choice, else `stable`;
  fetches `/channels/<channel>.json` and replaces the location with
  `/v/<version>/` (keeping the `#` route). A missing or invalid pointer is
  said on the page, never guessed.
- At `/callback`: hands the hub's answer to the build that asked (below).

It carries no inline script or style: the console's CSP (airdress-ops
`console.tf`) admits same-origin files only.

## The callback contract

The hub redirects every sign-in to the one registered address,
`https://console.airdress.co/callback`, which the entry document serves.
Several builds can be live at once, so the answer must reach the build
that started the sign-in, whose PKCE verifier is in `sessionStorage`:

1. **The build** sends `state = "<version>~<random>"`, its own version
   (`__CONSOLE_VERSION__`, set at build time) then a tilde then the random
   value (`src/auth/flow.ts`). Only the random part is secret-like; the
   whole string is what the build compares at the callback.
2. **The entry** at `/callback` takes the part before the first `~`,
   accepts it only if it is semver, and replaces the location with
   `/v/<version>/?<the hub's query>&oauth=callback`
   (`entry/route.ts`, `callbackTarget`). Anything else is reported, never
   routed.
3. **The build** treats `?oauth=callback` (or the path `/callback` under the
   dev server) as the callback, finishes the sign-in, and rewrites the
   address to its own path, `/v/<version>/#<route>` (`src/main.ts`).

`entry/contract.test.ts` holds both halves together. Changing the separator,
the query flag or the version format is a change to all three places and
to that test.
