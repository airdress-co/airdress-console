import type { QueryClient } from '@tanstack/vue-query';
import type { InjectionKey, Ref } from 'vue';
import { inject, readonly, ref } from 'vue';
import type { AuthConfig } from '@/config.ts';
import type { FetchLike } from './flow.ts';
import {
  SignInError,
  buildAuthorizeUrl,
  completeSignIn,
  refreshTokens,
  revokeRefreshToken,
} from './flow.ts';
import type { TokenVault } from './vault.ts';

/**
 * The signed-in state the app can see. It exposes whether there is a
 * session and for which operator, never a token: the token is read by
 * `bearer()` at request time and goes straight into a header.
 */
export interface Session {
  readonly signedIn: Readonly<Ref<boolean>>;
  readonly resource: Readonly<Ref<string | undefined>>;
  signIn(resource: string, returnTo: string, maxAge?: number): Promise<void>;
  completeSignIn(callback: URL): Promise<string>;
  /** The current access token, refreshing once if it has lapsed. */
  bearer(): Promise<string | undefined>;
  /**
   * When the person last entered their credentials (the token's `auth_time`,
   * Unix seconds), or undefined without a session or the claim. A refresh
   * keeps it; only an interactive sign-in moves it. The operator decides a
   * step-up from this same claim (R7), so the console can say in advance
   * that one is coming.
   */
  signedInAt(): number | undefined;
  /** Renew now; false means the person must sign in again. */
  refresh(): Promise<boolean>;
  /**
   * Re-scope the session to another resource of the same grant (the hub API,
   * or one owned operator's `/v1`), through a refresh. Serialized with every
   * other refresh: the hub rotates the refresh token, and a second
   * redemption of a spent one ends the family. Rejects with the hub's
   * refusal (`invalid_target` for an airdress the person does not own) and
   * leaves the session as it was; a spent grant ends it.
   */
  switchTo(resource: string): Promise<void>;
  /**
   * After a reload or a switch to another console version in this tab, or
   * in a new tab of a browser that is signed in: start the ordinary sign-in
   * again for the operator this tab (or, for a new tab, the browser's last
   * sign-in) was on, and come back to `route`. While the hub's own session lives and consent
   * stands, the hub answers with a code and shows nothing, so the person
   * sees a redirect, not a sign-in. Tokens are still never stored (FR-13):
   * what this reads is the resume hint, the resource and nothing else.
   * False when there is nothing to resume, a session is already held, or
   * an attempt started less than [`RESUME_RETRY_MS`] ago (no loop when the
   * hub cannot answer without the person).
   */
  resume(route: string): Promise<boolean>;
  signOut(): Promise<void>;
}

/**
 * The operator (or the hub API) this tab last held tokens for. Not a
 * token, and in `sessionStorage`, so it is this tab's alone and goes with
 * it; sign-out removes it.
 */
export const RESUME_KEY = 'airdress.console.resume';
/**
 * The same for the whole browser, in `localStorage`, so a new tab signs in
 * by itself: `{resource, at}`, the resource and when a sign-in last
 * completed, never a token. Sign-out in any tab removes it.
 */
export const SHARED_RESUME_KEY = 'airdress.console.resume-shared';
/**
 * How long a new tab follows the shared hint: the hub's own session
 * (12 h). Past it the hub would ask for a password, and a new tab should
 * show the console's sign-in page instead of the hub's unasked. A reload of
 * a tab that was signed in still resumes at any age.
 */
export const SHARED_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** When the last automatic resume started, so a failing one is not repeated. */
export const RESUME_ATTEMPT_KEY = 'airdress.console.resume-attempt';
export const RESUME_RETRY_MS = 60_000;

export const SessionKey: InjectionKey<Session> = Symbol('session');

export interface SessionDeps {
  readonly config: AuthConfig;
  readonly vault: TokenVault;
  readonly queryClient: QueryClient;
  readonly storage: Storage;
  /** Every tab's storage (`localStorage`), for [`SHARED_RESUME_KEY`]; none, and a new tab starts at sign-in. */
  readonly shared?: Storage;
  readonly fetch: FetchLike;
  readonly navigate: (url: string) => void;
  /** Milliseconds since the epoch; a test passes its own. */
  readonly now?: () => number;
  /**
   * Every console tab of this browser, for sign-out (a `BroadcastChannel`
   * named [`SIGN_OUT_CHANNEL`]). Each tab holds its own grant, so signing
   * out revokes this tab's and tells the others to forget theirs. The
   * message carries nothing: it can only end a session, never start one.
   */
  readonly tabs?: Pick<BroadcastChannel, 'postMessage' | 'addEventListener'>;
}

export const SIGN_OUT_CHANNEL = 'airdress.console.sign-out';

export function createSession(deps: SessionDeps): Session {
  const signedIn = ref(false);
  const resource = ref<string | undefined>(undefined);
  let inflightRefresh: Promise<boolean> | undefined;
  // Every redemption of the refresh token goes through this chain, one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  const now = deps.now ?? (() => Date.now());

  function remember(forResource: string): void {
    deps.storage.setItem(RESUME_KEY, forResource);
    deps.shared?.setItem(SHARED_RESUME_KEY, JSON.stringify({ resource: forResource, at: now() }));
  }

  /** This tab's hint, or else the browser's while it is young enough. */
  function hint(): string | undefined {
    const own = deps.storage.getItem(RESUME_KEY);
    if (own !== null && own !== '') return own;
    const raw = deps.shared?.getItem(SHARED_RESUME_KEY);
    if (raw === null || raw === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const { resource: r, at } = parsed as { resource?: unknown; at?: unknown };
      if (typeof r !== 'string' || r === '' || typeof at !== 'number') return undefined;
      return now() - at < SHARED_RESUME_MAX_AGE_MS ? r : undefined;
    } catch {
      return undefined;
    }
  }

  function end(): void {
    deps.vault.forget();
    // Whatever an operator returned dies with the session (design §3.3).
    deps.queryClient.clear();
    signedIn.value = false;
    resource.value = undefined;
  }

  async function doRefresh(): Promise<boolean> {
    const refreshToken = deps.vault.refreshToken();
    const forResource = deps.vault.resource();
    if (refreshToken === undefined || forResource === undefined) return false;
    try {
      deps.vault.hold(
        await refreshTokens(deps.config, refreshToken, forResource, deps.fetch),
        forResource,
      );
      return true;
    } catch {
      end();
      return false;
    }
  }

  function refresh(): Promise<boolean> {
    // One refresh at a time: the hub rotates refresh tokens, and two
    // concurrent redemptions of one would end the family.
    inflightRefresh ??= serialized(doRefresh).finally(() => {
      inflightRefresh = undefined;
    });
    return inflightRefresh;
  }

  function switchTo(target: string): Promise<void> {
    return serialized(async () => {
      const refreshToken = deps.vault.refreshToken();
      if (refreshToken === undefined) throw new SignInError('not_signed_in', 'Not signed in.');
      try {
        deps.vault.hold(await refreshTokens(deps.config, refreshToken, target, deps.fetch), target);
      } catch (error: unknown) {
        // A spent or revoked grant cannot be renewed for any resource.
        if (error instanceof SignInError && error.code === 'invalid_grant') end();
        throw error;
      }
      // Cached answers belonged to the previous resource's operator.
      deps.queryClient.clear();
      resource.value = target;
      remember(target);
    });
  }

  deps.vault.onRefreshDue(() => {
    void refresh();
  });

  /** Forget this tab's session and its resume hint, revoking its grant. */
  async function signOutHere(): Promise<void> {
    const refreshToken = deps.vault.refreshToken();
    deps.storage.removeItem(RESUME_KEY);
    deps.storage.removeItem(RESUME_ATTEMPT_KEY);
    deps.shared?.removeItem(SHARED_RESUME_KEY);
    end();
    if (refreshToken !== undefined) {
      try {
        await revokeRefreshToken(deps.config, refreshToken, deps.fetch);
      } catch {
        // The token is forgotten here either way; the hub's family expires on its own.
      }
    }
  }

  deps.tabs?.addEventListener('message', () => {
    void signOutHere();
  });

  return {
    signedIn: readonly(signedIn),
    resource: readonly(resource),
    async signIn(forResource, returnTo, maxAge) {
      const request =
        maxAge === undefined
          ? { resource: forResource, returnTo }
          : { resource: forResource, returnTo, maxAge };
      deps.navigate(await buildAuthorizeUrl(deps.config, request, deps.storage));
    },
    async completeSignIn(callback) {
      const done = await completeSignIn(deps.config, callback, deps.storage, deps.fetch);
      deps.vault.hold(done.tokens, done.resource);
      signedIn.value = true;
      resource.value = done.resource;
      remember(done.resource);
      deps.storage.removeItem(RESUME_ATTEMPT_KEY);
      return done.returnTo;
    },
    async resume(route) {
      if (signedIn.value) return false;
      const forResource = hint();
      if (forResource === undefined) return false;
      const last = Number(deps.storage.getItem(RESUME_ATTEMPT_KEY));
      if (Number.isFinite(last) && last > 0 && now() - last < RESUME_RETRY_MS) return false;
      deps.storage.setItem(RESUME_ATTEMPT_KEY, String(now()));
      deps.navigate(
        await buildAuthorizeUrl(
          deps.config,
          { resource: forResource, returnTo: route },
          deps.storage,
        ),
      );
      return true;
    },
    async bearer() {
      const current = deps.vault.accessToken();
      if (current !== undefined) return current;
      return (await refresh()) ? deps.vault.accessToken() : undefined;
    },
    refresh,
    switchTo,
    signedInAt: () => authTimeOf(deps.vault.accessToken()),
    async signOut() {
      await signOutHere();
      deps.tabs?.postMessage('signed-out');
    },
  };
}

/**
 * The route a resumed sign-in comes back to: the one in the address bar,
 * or the default when that is the connect page (the router then sends an
 * operator session on to its overview, a hub one to choose).
 */
export function resumeRoute(hash: string): string {
  const route = hash.replace(/^#/, '');
  return route.startsWith('/') && route !== '/' ? route : '/overview';
}

/** `auth_time` from a JWT access token's payload; undefined for anything else. */
export function authTimeOf(token: string | undefined): number | undefined {
  const payload = token?.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
    if (typeof claims !== 'object' || claims === null || !('auth_time' in claims)) return undefined;
    return typeof claims.auth_time === 'number' ? claims.auth_time : undefined;
  } catch {
    return undefined;
  }
}

export function useSession(): Session {
  const session = inject(SessionKey);
  if (session === undefined)
    throw new Error('useSession() needs a session provided at the app root');
  return session;
}
