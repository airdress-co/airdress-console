#!/bin/sh
# Document numbers stay out of code (the workspace rule, decided 2026-09-15;
# airdress-ops CLAUDE.md "Document numbers stay out of code"). Spec, RDR and
# RCP numbers belong in comments and Markdown, never in identifiers, strings,
# keys or file names.
#
#   1. Path: a tracked path matching (?i)(spec|rdr|rcp)[_-]?[0-9]{3} outside
#      Markdown and docs/ fails.
#   2. Content: a non-comment line of a code file containing a document
#      number fails. A line is a comment when, after leading whitespace, it
#      starts with // /// # * /* or <!--; a trailing `// …` or ` # …` is a
#      comment too.
#
# Exemption: a trailing `allow-doc-number: <reason>` on the line, reviewed
# and used sparingly. Lockfiles and node_modules are not read.
set -eu
cd "$(git rev-parse --show-toplevel)"

git ls-files -z | python3 -c '
import re, sys

SUMMARY = ("Document numbers (SPEC/RDR/RCP-NNN, and AC/FR/NFR/OQ or gate ids used as names) stay out of code: name the "
           "thing, and put the spec reference in a comment.")
PATH_RE = re.compile(r"(?i)(spec|rdr|rcp)[_-]?[0-9]{3}")
TOKEN_RE = re.compile(r"(?i)(?<![a-z0-9])(spec|rdr|rcp)[_-]?[0-9]{3}(?![0-9])")
# Finer references used as names: an acceptance criterion, requirement or
# open question attached to a name (ac14_foo, foo_fr41, SHELLS-OQ9), a
# lower-case design gate key (g3_mrr_drop), and the same in a file name
# (reactions_fr41.rs, x.nfr14.json). UUIDs and long hex or base64 runs are
# removed before the content match, so a UUID fragment like -ac79 is not a
# criterion. Bare runbook numbers and task ids are not matched: in code
# they are almost always prose (alert documentation, a runbook path).
FINE_RE = re.compile(
    r"(?i:(?<![a-z0-9])(n?fr|ac|oq)[-_]?[0-9]{1,3}[a-z]?_[a-z]"
    r"|[a-z0-9][_-](n?fr|ac|oq)[-_]?[0-9]{1,3}[a-z]?(?![a-z0-9]))"
    r"|\bg[1-9]_[a-z_]{3,}")
FINE_PATH_RE = re.compile(r"(?i)[._-](n?fr|ac|oq|g)[0-9]{1,3}([._-]|$)")
NOISE_RE = re.compile(
    r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|[0-9a-f]{8,}|[a-z0-9+/=]{40,}")
CODE_EXT = (".ts", ".mts", ".vue", ".js", ".mjs", ".cjs", ".json", ".yaml",
            ".yml", ".sh", ".html", ".css")
SKIP = ("package-lock.json",)
# Contracts of other repositories, copied byte for byte and pinned: the
# operator openapi.yaml (prose descriptions cite its specs) and the types
# generated from it. Editing them would break the pin; they are checked by
# npm run check:api instead.
VENDORED = ("api/operator-openapi.yaml", "src/api/generated/")
LINE_COMMENT = ("///", "//", "#", "/*", "*", "<!--")
TRAILING = re.compile(r"(^|\s)(//|#)(\s|$)")

def is_doc(path):
    return path.endswith(".md") or path.startswith("docs/")

def code_part(line):
    if line.lstrip().startswith(LINE_COMMENT):
        return ""
    m = TRAILING.search(line)
    return line[: m.start()] if m else line

failures = []
for path in sys.stdin.buffer.read().decode().split("\0"):
    if not path or is_doc(path) or path.startswith(VENDORED):
        continue
    if PATH_RE.search(path) or FINE_PATH_RE.search(path.rsplit("/", 1)[-1]):
        failures.append(f"{path}: file name carries a document number")
    if path.rsplit("/", 1)[-1] in SKIP or not path.endswith(CODE_EXT):
        continue
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, UnicodeDecodeError):
        continue
    for n, line in enumerate(lines, 1):
        if "allow-doc-number:" in line:
            continue
        code = code_part(line)
        if TOKEN_RE.search(code) or FINE_RE.search(NOISE_RE.sub("", code)):
            failures.append(f"{path}:{n}: {line.strip()}")

if failures:
    for f in failures:
        print(f, file=sys.stderr)
    print(SUMMARY, file=sys.stderr)
    sys.exit(1)
'
