# Contributing

## Commits and pull requests

- Conventional commits (`feat(auth): …`, `fix(machines): …`); the
  `commit-msg` hook checks it. release-please reads them to choose the next
  version and write `CHANGELOG.md`.
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

## Releasing (two deliberate steps)

Publishing is never automatic. A release is three separate acts:

1. **Tag.** Merge the release-please pull request. That tags `vX.Y.Z` and
   builds the artifact; it does not deploy anything.
2. **Publish.** `just console-publish vX.Y.Z` (in airdress-ops) uploads the
   build to `/v/X.Y.Z/`. It refuses a version that already exists: a
   published version is immutable.
3. **Promote.** `just console-promote next vX.Y.Z` to try it, then
   `just console-promote stable vX.Y.Z` to make it the default. Rolling back
   is the same command with the previous version.

Every published version stays loadable by its path, so a person can open
an older build while a problem is fixed.
