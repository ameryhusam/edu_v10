/**
 * Who is signed in.
 *
 * This holds identity for *presentation* — which navigation to show, whose
 * name to greet. It is **not** an authorization boundary. Every protected call
 * still goes to the backend and every screen still handles a 403, because a
 * client that decides what it is allowed to do has decided nothing at all
 * (§13).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken, setSessionEndedListener } from '../api/client';
import type { RoleName, ScopedRole } from '../types/roles';

/**
 * The signed-in user as the client knows them.
 *
 * `fullName` comes from the login response. `/auth/me` does not return it
 * (gap G5 in the frontend audit), so a page reload currently recovers identity
 * without a display name. That is rendered honestly — the header falls back to
 * the username rather than inventing one.
 */
export interface SessionUser {
  readonly userKey: string;
  readonly username: string | null;
  readonly fullName: string | null;
  readonly roles: readonly ScopedRole[];
  /** Present only for users who are themselves learners. */
  readonly learnerKey: string | null;
}

type SessionStatus = 'restoring' | 'authenticated' | 'anonymous';

interface SessionValue {
  readonly status: SessionStatus;
  readonly user: SessionUser | null;
  readonly signIn: (identifier: string, password: string) => Promise<void>;
  /** Adopt a session from a registration response, which already authenticated. */
  readonly adoptSession: (result: LoginResponse) => void;
  readonly signOut: () => Promise<void>;
  readonly hasRole: (...roles: readonly RoleName[]) => boolean;
  /** The school ids this actor holds any role in — the only source of scope. */
  readonly schoolIds: readonly string[];
}

const SessionContext = createContext<SessionValue | null>(null);

interface LoginResponse {
  readonly user: {
    readonly key: string;
    readonly username: string;
    readonly fullName: string;
    readonly roles: readonly string[];
    readonly learnerKey: string | null;
  };
  readonly tokens: { readonly accessToken: string };
}

/**
 * GET /auth/me now returns the account, not just the token claims (gap G5
 * closed 2026-09-12). `roles` is the flattened name list; `scopedRoles` carries
 * the school scope, which is what the UI needs to pick a default school.
 */
interface MeResponse {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly locale: string;
  readonly roles: readonly string[];
  readonly learnerKey: string | null;
  readonly scopedRoles: readonly ScopedRole[];
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const [user, setUser] = useState<SessionUser | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  // The client layer signals an unrecoverable auth failure; the session
  // reacts. Inverted deliberately: the API client must not import React.
  useEffect(() => {
    setSessionEndedListener(clear);
    return () => setSessionEndedListener(null);
  }, [clear]);

  /**
   * Restore on load.
   *
   * The access token is in memory and therefore gone after a reload. The
   * refresh cookie is httpOnly and survives, so `/auth/me` triggers exactly
   * one refresh through the client's single-flight path and the session comes
   * back without the user retyping anything.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const me = await api.get<MeResponse>('auth/me');
        if (cancelled) return;
        setUser({
          userKey: me.key,
          username: me.username,
          fullName: me.fullName,
          roles: me.scopedRoles,
          learnerKey: me.learnerKey,
        });
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        /**
         * Only the *restoring* state may be ended by this probe.
         *
         * On a cold load there is no refresh cookie, so this request 401s,
         * triggers a refresh that also 401s, and finally rejects. That whole
         * sequence is slower than a person typing a password they already
         * know. If the user signed in while it was still in flight, calling
         * `clear()` here destroyed the session that had just been created and
         * the router sent them straight back to the login form — which is
         * precisely the "login does nothing" fault.
         *
         * A request that started before the session exists has no authority
         * over it. Checking the status at resolution time, rather than at
         * dispatch time, is what makes the outcome independent of who wins
         * the race.
         */
        setStatus((current) => (current === 'restoring' ? 'anonymous' : current));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Adopt an authenticated response as the current session.
   *
   * Shared by sign-in and registration, because the backend authenticates a
   * new account through the same login use case — so the two responses are the
   * same shape and must produce the same session. Two copies of this mapping
   * would eventually disagree about one field.
   */
  const adoptSession = useCallback((result: LoginResponse) => {
    setAccessToken(result.tokens.accessToken);
    setUser({
      userKey: result.user.key,
      username: result.user.username,
      fullName: result.user.fullName,
      // Login returns bare role names; /auth/me returns scoped grants. Widened
      // to the scoped shape with a null school so the two never diverge in
      // type.
      roles: result.user.roles.map((role) => ({ role: role as RoleName, schoolId: null })),
      learnerKey: result.user.learnerKey,
    });
    setStatus('authenticated');

    /**
     * Then immediately refine the scope.
     *
     * The null school above is a placeholder, and leaving it there was a real
     * bug: `schoolIds` came back empty, so a teacher who had just signed in
     * was told "no school is linked to your account" until they reloaded the
     * page and the restore path fetched `/auth/me`. Sign-in and reload must
     * produce the same session, so the scoped grants are fetched here too.
     *
     * Failure is deliberately silent: the session is already valid, and the
     * screens that need a school scope handle its absence honestly.
     */
    void (async () => {
      try {
        const me = await api.get<MeResponse>('auth/me');
        setUser((current) =>
          current === null ? current : { ...current, roles: me.scopedRoles },
        );
      } catch {
        // Keep the unscoped session rather than signing the user back out.
      }
    })();
  }, []);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const result = await api.post<LoginResponse>(
        'auth/login',
        { identifier, password },
        // A failed login must not try to refresh: there is no session to
        // refresh, and the retry would turn one clear 401 into a confusing
        // second one.
        { skipAuthRefresh: true },
      );
      adoptSession(result);
    },
    [adoptSession],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('auth/logout');
    } catch {
      // Signing out locally must succeed even if the call fails — otherwise a
      // user on a shared device cannot get out.
    }
    clear();
  }, [clear]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      signIn,
      adoptSession,
      signOut,
      hasRole: (...roles) => (user?.roles ?? []).some((grant) => roles.includes(grant.role)),
      schoolIds: [
        ...new Set(
          (user?.roles ?? [])
            .map((grant) => grant.schoolId)
            .filter((id): id is string => id !== null),
        ),
      ],
    }),
    [status, user, signIn, adoptSession, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside SessionProvider.');
  }
  return context;
}
