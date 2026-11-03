#!/bin/sh
# Install the pinned git-cliff into $1 (default ./.tools/bin), verified by its
# SHA-512 before it is unpacked. Used by release.yml and release-check.yml;
# a version change is a reviewed edit of both lines below.
set -eu
VERSION=2.14.2
SHA512=26d1f7c8ea2400f2ccb0b2e7f321635f600b583bf4cd1f7afaa5e8c24068ad1088a2504e0a4d9f4333d4bb20a80329327d9462634343ee3af91e1a7fbdc6f18a
dest="${1:-.tools/bin}"
name="git-cliff-${VERSION}-x86_64-unknown-linux-gnu.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$name" "https://github.com/orhun/git-cliff/releases/download/v${VERSION}/${name}"
echo "${SHA512}  $tmp/$name" | sha512sum -c - >/dev/null
tar -xzf "$tmp/$name" -C "$tmp"
mkdir -p "$dest"
install -m 0755 "$tmp/git-cliff-${VERSION}/git-cliff" "$dest/git-cliff"
"$dest/git-cliff" --version
