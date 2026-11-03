#!/bin/sh
# Fetch the airdress-operator release the console's API is pinned to
# (api/operator-openapi.pin), check it against the release manifest's
# SHA-256, and print its path. Cached under ~/.cache/airdress-console-e2e,
# so a second run downloads nothing. Linux x86-64 and arm64.
#
#   AIRDRESS_OPERATOR_BIN=$(sh e2e/fetch-operator.sh) npm run e2e
set -eu
version=$(cut -d' ' -f1 api/operator-openapi.pin)
case "$(uname -m)" in
  x86_64) platform=linux-amd64 ;;
  aarch64 | arm64) platform=linux-arm64 ;;
  *) echo "no operator release for $(uname -m)" >&2; exit 1 ;;
esac
base="https://downloads.airdress.co/airdress-operator/${version}"
dir="${XDG_CACHE_HOME:-$HOME/.cache}/airdress-console-e2e/${version}"
bin="${dir}/airdress-operator-${platform}"
mkdir -p "$dir"
want=$(curl -fsS "${base}/manifest.json" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const a = JSON.parse(s).artifacts.find((x) => x.platform === process.argv[1] && x.kind === "binary");
    if (!a) process.exit(1);
    process.stdout.write(a.sha256);
  });' "$platform")
if [ ! -f "$bin" ] || [ "$(sha256sum "$bin" | cut -d' ' -f1)" != "$want" ]; then
  curl -fsS -o "${bin}.part" "${base}/airdress-operator-${platform}"
  got=$(sha256sum "${bin}.part" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "checksum mismatch for ${version} ${platform}: got ${got}, manifest says ${want}" >&2
    rm -f "${bin}.part"
    exit 1
  fi
  mv "${bin}.part" "$bin"
  chmod +x "$bin"
fi
echo "$bin"
