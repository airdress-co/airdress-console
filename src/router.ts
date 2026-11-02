import type { RouteRecordRaw, Router } from 'vue-router';
import { createRouter, createWebHashHistory } from 'vue-router';

// Hash history: every build is served from a static bucket under its own
// /v/<semver>/ prefix, with no server to rewrite deep links to the app.
const routes: readonly RouteRecordRaw[] = [
  { path: '/', name: 'connect', component: () => import('@/views/ConnectView.vue') },
  { path: '/:pathMatch(.*)*', redirect: { name: 'connect' } },
];

export function createConsoleRouter(): Router {
  return createRouter({ history: createWebHashHistory(), routes });
}
