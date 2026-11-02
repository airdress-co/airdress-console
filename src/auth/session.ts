import type { QueryClient } from '@tanstack/vue-query';
import type { InjectionKey, Ref } from 'vue';
import { inject, readonly, ref } from 'vue';
import type { AuthConfig } from '@/config.ts';
import type { FetchLike } from './flow.ts';
import { buildAuthorizeUrl, completeSignIn, refreshTokens, revokeRefreshToken } from './flow.ts';
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
  /** Renew now; false means the person must sign in again. */
  refresh(): Promise<boolean>;
  signOut(): Promise<void>;
}

export const SessionKey: InjectionKey<Session> = Symbol('session');

export interface SessionDeps {
  readonly config: AuthConfig;
  readonly vault: TokenVault;
  readonly queryClient: QueryClient;
  readonly storage: Storage;
  readonly fetch: FetchLike;
  readonly navigate: (url: string) => void;
}

export function createSession(deps: SessionDeps): Session {
  const signedIn = ref(false);
  const resource = ref<string | undefined>(undefined);
  let inflightRefresh: Promise<boolean> | undefined;

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
    inflightRefresh ??= doRefresh().finally(() => {
      inflightRefresh = undefined;
    });
    return inflightRefresh;
  }

  deps.vault.onRefreshDue(() => {
    void refresh();
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
      return done.returnTo;
    },
    async bearer() {
      const current = deps.vault.accessToken();
      if (current !== undefined) return current;
      return (await refresh()) ? deps.vault.accessToken() : undefined;
    },
    refresh,
    async signOut() {
      const refreshToken = deps.vault.refreshToken();
      end();
      if (refreshToken !== undefined) {
        try {
          await revokeRefreshToken(deps.config, refreshToken, deps.fetch);
        } catch {
          // The token is forgotten here either way; the hub's family expires on its own.
        }
      }
    },
  };
}

export function useSession(): Session {
  const session = inject(SessionKey);
  if (session === undefined)
    throw new Error('useSession() needs a session provided at the app root');
  return session;
}
