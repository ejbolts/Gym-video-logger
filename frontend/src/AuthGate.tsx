import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { AuthBrand, AuthScreen } from './AuthScreen';
import { subscribeAuthExpired } from './authEvents';
import { adoptSignedInUser, resolveSession, type AuthState } from './authSession';
import {
  browserDeps,
  clearAfterAccountDeletion,
  rememberUser,
  restartApp,
  signOutAndClear,
} from './sessionCleanup';
import { TodaySkeleton } from './TodayScreen';
import type { AuthConfig, User } from './types';
import { UserContext, type UserSession } from './userContext';

export function AuthLoading() {
  return (
    <div className="tracker-app">
      <main className="tracker-content">
        <TodaySkeleton />
      </main>
    </div>
  );
}

function AuthUnreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="auth-screen">
      <div className="auth-shell">
        <AuthBrand />
        <section className="auth-card" aria-label="Connection problem">
          <h2 className="auth-card-title">Cannot connect</h2>
          <p className="auth-note" role="alert">
            {message}
          </p>
          <button type="button" className="auth-submit" onClick={onRetry}>
            <span>Try again</span>
          </button>
        </section>
      </div>
    </main>
  );
}

export interface AuthGateViewProps {
  state: AuthState;
  authConfig: AuthConfig | null;
  session: UserSession;
  children: ReactNode;
  onAuthenticated: (user: User) => Promise<void>;
  onRetry: () => void;
}

/** Chooses what to show for an auth state. Kept separate from the effects so it can be tested. */
export function AuthGateView({
  state,
  authConfig,
  session,
  children,
  onAuthenticated,
  onRetry,
}: AuthGateViewProps) {
  switch (state.status) {
    case 'loading':
      return <AuthLoading />;
    case 'unreachable':
      return <AuthUnreachable message={state.message} onRetry={onRetry} />;
    case 'signed-out':
      return <AuthScreen config={authConfig} onAuthenticated={onAuthenticated} />;
    case 'authenticated':
      return (
        <UserContext.Provider value={session}>
          {/* Keyed by account so a different user always starts from fresh React state. */}
          <Fragment key={state.user.id}>{children}</Fragment>
        </UserContext.Provider>
      );
  }
}

/**
 * Asks the server who is signed in before the app mounts, so none of the app's data loading
 * starts without a session. A 401 shows the sign-in screen; the app also drops back to it when
 * any later request reports the session has ended.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void resolveSession({ ...browserDeps(), me: api.auth.me }).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => subscribeAuthExpired(() => setState({ status: 'signed-out' })), []);

  const signedOut = state.status === 'signed-out';
  useEffect(() => {
    if (!signedOut) return;
    let cancelled = false;
    void api.auth
      .config()
      .then((config) => {
        if (!cancelled) setAuthConfig(config);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedOut]);

  // Started offline with a remembered account: confirm the session once the connection returns.
  const offline = state.status === 'authenticated' && state.offline;
  useEffect(() => {
    if (!offline) return;
    const confirm = () => setAttempt((current) => current + 1);
    window.addEventListener('online', confirm);
    return () => window.removeEventListener('online', confirm);
  }, [offline]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  const onAuthenticated = useCallback(async (user: User) => {
    setState(await adoptSignedInUser(user, browserDeps()));
  }, []);

  const session = useMemo<UserSession>(
    () => ({
      user: state.status === 'authenticated' ? state.user : null,
      updateUser: (user) => {
        rememberUser(user);
        setState((current) =>
          current.status === 'authenticated' ? { ...current, user } : current,
        );
      },
      signOut: async () => {
        await signOutAndClear();
        restartApp();
      },
      accountDeleted: async () => {
        await clearAfterAccountDeletion();
        restartApp();
      },
    }),
    [state],
  );

  return (
    <AuthGateView
      state={state}
      authConfig={authConfig}
      session={session}
      onAuthenticated={onAuthenticated}
      onRetry={retry}
    >
      {children}
    </AuthGateView>
  );
}
