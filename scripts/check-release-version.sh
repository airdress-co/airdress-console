#!/bin/sh
# The version computation of release.yml, checked offline against a
# throwaway repository with crafted commits and this repo's cliff.toml.
# Needs git-cliff on PATH (scripts/install-git-cliff.sh).
set -eu
cfg="$(cd "$(dirname "$0")/.." && pwd)/cliff.toml"
repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q -b main
git config user.email release-check@invalid
git config user.name release-check
fail=0
commit() { git commit -q --allow-empty -m "$1"; }
bumped() { git cliff --config "$cfg" --bumped-version 2>/dev/null; }
releasable() { git cliff --config "$cfg" --unreleased --strip all 2>/dev/null | grep -c '^- ' || true; }
expect() {
  if [ "$2" = "$3" ]; then echo "ok   $1 ($3)"; else echo "FAIL $1: want $2, got $3"; fail=1; fi
}

commit "chore: start"
expect "no tag, nothing releasable" 0 "$(releasable)"
commit "feat: first"
expect "no tag yet starts at v0.1.0" v0.1.0 "$(bumped)"
git tag -a v0.1.0 -m v0.1.0
commit "fix: a"
expect "fix bumps the patch" v0.1.1 "$(bumped)"
commit "feat(auth): b"
expect "feat bumps the minor" v0.2.0 "$(bumped)"
commit "feat!: c"
expect "breaking on 0.x bumps the minor, not 1.0.0" v0.2.0 "$(bumped)"
git tag -a v0.2.0 -m v0.2.0
commit "docs: d"
commit "chore(deps): e"
expect "docs and chore alone are not releasable" 0 "$(releasable)"
commit "perf: f"
expect "perf bumps the patch" v0.2.1 "$(bumped)"
git tag -a v1.0.0 -m v1.0.0
commit "feat: g"
expect "feat on 1.x bumps the minor" v1.1.0 "$(bumped)"
commit "fix: h

BREAKING CHANGE: the old route is gone"
expect "a BREAKING CHANGE footer on 1.x bumps the major" v2.0.0 "$(bumped)"
exit "$fail"
