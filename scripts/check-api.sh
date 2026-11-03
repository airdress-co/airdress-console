#!/bin/sh
# The operator API types are generated from the pinned openapi.yaml
# (api/operator-openapi.pin) and committed. Regenerate and fail on any
# difference, so the committed types cannot drift from the pinned contract.
# openapi-typescript is fetched by npx, not a dependency: its peer range
# stops at TypeScript 5, and nothing of it reaches the bundle.
set -eu
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
npx --yes openapi-typescript@7.13.0 api/operator-openapi.yaml -o "$tmp" >/dev/null
if ! cmp -s "$tmp" src/api/generated/operator.d.ts; then
  echo "src/api/generated/operator.d.ts is stale: run npm run gen:api" >&2
  exit 1
fi
echo "operator API types match $(cat api/operator-openapi.pin)"
