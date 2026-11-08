#!/bin/sh
# WebKit needs system libraries some Linux hosts lack (Ubuntu 26.04:
# libevent-2.1-7t64, libmanette-0.2-0, libhidapi-hidraw0; WebKit 2370 also
# libavif16, libgav1-1 and libyuv0). Installing them
# needs root; this does not. It downloads the packages from this machine's own
# apt sources and unpacks them into a private directory, which
# playwright.config.ts preloads into WebKit only. Nothing is installed.
# CI uses `playwright install --with-deps` instead.
set -eu
dir="${AIRDRESS_WEBKIT_LIBS_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/playwright-webkit-libs}"
mkdir -p "$dir/debs"
cd "$dir/debs"
apt-get download libevent-2.1-7t64 libmanette-0.2-0 libhidapi-hidraw0 libavif16 libgav1-1 libyuv0
for deb in *.deb; do dpkg-deb -x "$deb" "$dir/root"; done
echo "$dir/root/usr/lib/x86_64-linux-gnu"
