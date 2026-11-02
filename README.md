# airdress-console

The Airdress operator console: a static web app that connects to **your own**
operator, the way a Betaflight configurator connects to a flight controller.
The operator ships no UI; this console is a client of its HTTPS API, like the
CLI and the VS Code extension.

- Served at `https://console.airdress.co`, from our CDN, every release under
  its own immutable path (`/v/<version>/`).
- You sign in with your Airdress account. The console holds an access token
  for one operator, in memory only, for 15 minutes at a time.
- It works with any operator that names the Airdress hub as its
  authorization server and admits the console's origin in its CORS
  configuration.

Specification: SPEC-184 in `airdress-co/airdress-specs`
(`airdress-operator/specs/SPEC-184-operator-console/`).

## Development

```sh
npm ci            # installs run no scripts (.npmrc ignore-scripts)
npm run dev       # http://127.0.0.1:5173
npm run check     # typecheck, lint, format, tests, build, bundle and doc-number checks
```

Sign-in against a real hub needs the console's loopback redirect registered
for the `airdress-console` client; `VITE_AUTH_ISSUER` points the console at
another authorization server.

## Rules this repository holds itself to

- **Strict types and lint, no warnings.** `vue-tsc` with strict templates and
  the strict compiler flags; type-aware `typescript-eslint`
  (`strictTypeChecked`) and `eslint-plugin-vue` errors only.
- **Idiomatic Vue 3.** `<script setup lang="ts">`, Composition API only,
  type-declared props and emits, logic in composables.
- **No store.** Server state is TanStack Query (keys rooted at the operator's
  FQDN, no persister); app state is a few provided composables.
- **The tokens never leave the auth module's closure**: not in storage, not in
  the query cache, not in a URL.
- **What ships is allowlisted.** `bundle-allowlist.json` lists every package
  that may appear in the production bundle; `npm run check:bundle` fails on
  anything else, on `eval`/`new Function`, and over a 200 KiB gzip budget.

## Licence

Apache-2.0.
