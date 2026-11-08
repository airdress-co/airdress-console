#!/bin/sh
# Every measurement of the 189-0.2 report, in order. Results: spike/results/.
set -u
rm -rf spike/results
npx vite build -c vite.spike.config.ts
npx playwright test -c playwright.spike.config.ts -g "fixture size|heap|scaling"
SPIKE_FLUSH=0,1 npx playwright test -c playwright.spike.config.ts --project=chromium -g levers
SPIKE_MODE=headed SPIKE_SIZES=300,1000,3000 SPIKE_FLUSH=0 npx playwright test -c playwright.spike.config.ts -g levers --headed
SPIKE_MODE=headed SPIKE_TAG=-big SPIKE_SIZES=6000,10000,20000,30000 SPIKE_OPTS='nodash;cache,nodash' SPIKE_FLUSH=0 \
  npx playwright test -c playwright.spike.config.ts --project=chromium -g levers --headed
