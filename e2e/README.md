# End-to-end tests

The console in Chromium, Firefox, WebKit and WebKit as an iPhone
(`mobile-safari`: Safari on iOS's engine, viewport, touch and user agent;
SPEC-184 AC-11), against a **real
airdress-operator** and a stand-in for the hub's OAuth authorization server
(SPEC-184 184-D.13, and the accessibility audit of 184-D.14).

```sh
npm run e2e                     # fetches the pinned operator release if needed
E2E_BUILD=1 npm run e2e         # the production build under security-headers.json (what CI runs)
npx playwright test --project=webkit e2e/console.spec.ts   # one browser, one file
```

## What runs

- **The operator** is the release `api/operator-openapi.pin` names (v0.1.171),
  fetched from downloads.airdress.co and checked against the release
  manifest's SHA-256 by `e2e/fetch-operator.sh` (cached in
  `~/.cache/airdress-console-e2e/`). Set `AIRDRESS_OPERATOR_BIN` to use a
  local build instead, e.g. airdress-operator at the same tag built with
  `cargo build -p airdress-operator`. It runs with embedded PostgreSQL in a
  throwaway directory, chat on (as every fleet operator), admitting the
  console's origin, with `[auth] hub_issuer` the fake server and an 8-second
  step-up window (`e2e/harness/operator.ts`).
- **The fake authorization server** (`e2e/harness/fake-as.ts`, no
  dependencies) mints `at+jwt` tokens with exactly the claims of the
  operator's own `tests/common/hub_as.rs`, consents at once, rotates refresh
  tokens and lists the one airdress at `/api/airdresses`.
- **The console** is the Vite dev server, with `VITE_AUTH_ISSUER`,
  `VITE_E2E_OPERATOR_ORIGIN` and `VITE_AIRDRESS_ZONE` pointing it at the
  harness. A published build sets none of them. With `E2E_BUILD=1` it is
  instead the production build served by `vite preview` with the headers in
  `security-headers.json`, `connect-src` pointed at the harness and the
  Trusted Types rules (report-only in production) enforced; any refusal the
  browser logs fails the test. WebKit's own `<select>` asks for an inline
  stylesheet, which `style-src 'self'` refuses on any page, ours or not
  (measured on a bare page, 2026-11-11): that one message is tolerated in
  WebKit only.

## What is checked

| Test                                         | Covers                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| signs in, lists, reads                       | FR-16 sign-in and choosing; AC-8 (no issued token in local/session storage, cookies, IndexedDB or the URL); AC-12 (no request to any third party)                                                                                                                                                              |
| the operator holds the line                  | AC-5 from the browser, through real CORS: a console token reads; another operator's audience is refused `401`; `location.read` is refused `403 insufficient_scope`; a stale sign-in reads but a destructive write is refused `401 insufficient_user_authentication` with `max_age`; `x-request-id` is readable |
| a reload comes back signed in                | FR-13/FR-14 as amended 2026-11-11: a reload of an area signs in again by itself and lands on it; signing out in one tab sends a second tab to sign-in; after sign-out a reload stays at sign-in                                                                                                                |
| a destructive write after the step-up window | R7/FR-42 end to end: the operator refuses, the console signs in again with `max_age=8`, comes back to the area, offers the action again, and it completes                                                                                                                                                      |
| every screen meets WCAG 2.2 AA               | axe on every screen and an open dialog, per browser                                                                                                                                                                                                                                                            |

Every test also fails on any error the page did not handle (`e2e/fixtures.ts`).

## Timings (this workstation, 2026-11-03)

- Fetching the operator release: about 8 s the first time, 0 after.
- Operator ready: under 1 s (embedded PostgreSQL already prestaged).
- The suite, 12 tests in three browsers: about 55 s. The step-up tests wait
  out the 8-second window, about 10 s each.

## Linux hosts without WebKit's libraries

On Ubuntu 26.04 WebKit lacks three system libraries. Without root:

```sh
sh e2e/webkit-libs.sh   # downloads and unpacks them privately; installs nothing
```

`playwright.config.ts` preloads them into WebKit when that directory exists.
Embedded PostgreSQL on Ubuntu 26.04 likewise needs the 24.04 `libxml2` and
`libicu`; `e2e/harness/operator.ts` uses `~/.cache/pglibs-noble/…` and a
prestaged PostgreSQL in `~/.cargo/.pg-prestage/current` when they exist
(airdress-ops: the embedded-PostgreSQL notes).

## CI

`.github/workflows/e2e.yml`, opt-in: dispatch it, or label a pull request
`e2e`. About three minutes, most of it installing browsers with their system
libraries, so it does not run on every push.
