import type { RouteRecordRaw, Router } from 'vue-router';
import { createRouter, createWebHashHistory } from 'vue-router';
import type { Session } from '@/auth/session.ts';
import { fqdnOf } from '@/operator/connection.ts';

// Hash history: every build is served from a static bucket under its own
// /v/<semver>/ prefix, with no server to rewrite deep links to the app.
const routes: readonly RouteRecordRaw[] = [
  { path: '/', name: 'connect', component: () => import('@/views/ConnectView.vue') },
  { path: '/choose', name: 'choose', component: () => import('@/features/choose/ChooseView.vue') },
  {
    path: '/overview',
    name: 'overview',
    component: () => import('@/features/overview/OverviewView.vue'),
  },
  { path: '/people', name: 'people', component: () => import('@/features/people/PeopleView.vue') },
  {
    path: '/devices',
    name: 'devices',
    component: () => import('@/features/devices/DevicesView.vue'),
  },
  {
    path: '/machines',
    name: 'machines',
    component: () => import('@/features/machines/MachinesView.vue'),
  },
  {
    path: '/subnames',
    name: 'subnames',
    component: () => import('@/features/subnames/SubnamesView.vue'),
  },
  { path: '/shells', name: 'shells', component: () => import('@/features/shells/ShellsView.vue') },
  { path: '/grants', name: 'grants', component: () => import('@/features/grants/GrantsView.vue') },
  {
    path: '/functions',
    name: 'functions',
    component: () => import('@/features/functions/FunctionsView.vue'),
  },
  {
    path: '/functions/:name',
    name: 'function',
    component: () => import('@/features/functions/FunctionView.vue'),
    props: true,
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'connect' } },
];

export function createConsoleRouter(): Router {
  return createRouter({ history: createWebHashHistory(), routes });
}

/**
 * Where a navigation should go given the session, or true to let it through.
 * Connect is always open (a signed-in person may still connect a self-hosted
 * operator by address); choosing needs a sign-in; an area needs a chosen
 * operator.
 */
export function sessionTarget(
  routeName: string | symbol | null | undefined,
  signedIn: boolean,
  connected: boolean,
): true | { readonly name: string } {
  if (routeName === 'connect') return true;
  if (!signedIn) return { name: 'connect' };
  if (routeName === 'choose') return true;
  return connected ? true : { name: 'choose' };
}

/**
 * Every area needs a session: tokens live in memory only (FR-13), so a
 * reload lands on connect and a sign-in brings the person back. Installed by
 * the app shell, which also re-checks the route it mounted on.
 */
export function installSessionGuard(router: Router, session: Session): void {
  router.beforeEach((to) =>
    sessionTarget(to.name, session.signedIn.value, fqdnOf(session.resource.value) !== undefined),
  );
}
