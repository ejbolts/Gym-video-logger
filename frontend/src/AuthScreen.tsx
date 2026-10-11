import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  DEFAULT_AUTH_CONFIG,
  MIN_PASSWORD_LENGTH,
  USERNAME_HINT,
  submitAuthForm,
  type AuthFieldErrors,
  type AuthMode,
} from './authForm';
import type { AuthConfig, User } from './types';

interface AuthScreenProps {
  /** Null while the public config is still loading; the form falls back to safe defaults. */
  config: AuthConfig | null;
  onAuthenticated: (user: User) => Promise<void> | void;
  initialMode?: AuthMode;
}

function Spinner() {
  return <span className="auth-spinner" aria-hidden="true" />;
}

function AuthField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && (
        <small id={`${id}-hint`} className="auth-hint">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="auth-field-error">
          {error}
        </small>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

export function AuthBrand() {
  return (
    <header className="auth-brand">
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>Gym Logger</h1>
      <p>Log every set, track every PR.</p>
    </header>
  );
}

export function AuthScreen({ config, onAuthenticated, initialMode = 'sign-in' }: AuthScreenProps) {
  const effectiveConfig = config ?? DEFAULT_AUTH_CONFIG;
  const registrationOpen = effectiveConfig.registration_open;
  const idPrefix = useId();
  const [requestedMode, setMode] = useState<AuthMode>(initialMode);
  const mode: AuthMode = registrationOpen ? requestedMode : 'sign-in';
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteRevealed, setInviteRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});

  const creating = mode === 'create-account';
  const showInviteCode = creating && (effectiveConfig.invite_code_required || inviteRevealed);
  const ids = {
    name: `${idPrefix}-name`,
    username: `${idPrefix}-username`,
    password: `${idPrefix}-password`,
    invite: `${idPrefix}-invite`,
  };

  function switchMode(next: AuthMode) {
    if (submitting || next === mode) return;
    setMode(next);
    setError(null);
    setFieldErrors({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    const result = await submitAuthForm(
      mode,
      { displayName, username, password, inviteCode },
      effectiveConfig,
    );
    if (result.ok) {
      try {
        await onAuthenticated(result.user);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setSubmitting(false);
    setError(result.message);
    setFieldErrors(result.fieldErrors);
    if (result.needsInviteCode) setInviteRevealed(true);
    const firstInvalid = (['displayName', 'username', 'password', 'inviteCode'] as const).find(
      (field) => result.fieldErrors[field],
    );
    const target = {
      displayName: ids.name,
      username: ids.username,
      password: ids.password,
      inviteCode: ids.invite,
    }[firstInvalid ?? 'username'];
    if (firstInvalid) window.requestAnimationFrame(() => document.getElementById(target)?.focus());
  }

  return (
    <main className="auth-screen">
      <div className="auth-shell">
        <AuthBrand />
        <section className="auth-card" aria-label="Account access">
          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button
              type="button"
              role="tab"
              id={`${idPrefix}-tab-sign-in`}
              aria-selected={!creating}
              aria-controls={`${idPrefix}-form`}
              className={!creating ? 'active' : ''}
              onClick={() => switchMode('sign-in')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              id={`${idPrefix}-tab-create`}
              aria-selected={creating}
              aria-controls={`${idPrefix}-form`}
              aria-disabled={!registrationOpen}
              disabled={!registrationOpen}
              className={creating ? 'active' : ''}
              onClick={() => switchMode('create-account')}
            >
              Create account
            </button>
          </div>

          {!registrationOpen && (
            <p className="auth-note">
              New accounts are closed on this server. Ask whoever runs it for access, then sign in
              here.
            </p>
          )}

          <form
            id={`${idPrefix}-form`}
            role="tabpanel"
            aria-labelledby={`${idPrefix}-tab-${creating ? 'create' : 'sign-in'}`}
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            {creating && (
              <AuthField id={ids.name} label="Name" error={fieldErrors.displayName}>
                <input
                  id={ids.name}
                  name="name"
                  type="text"
                  autoComplete="name"
                  autoCapitalize="words"
                  required
                  value={displayName}
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  aria-describedby={describedBy(ids.name, fieldErrors.displayName)}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </AuthField>
            )}

            <AuthField
              id={ids.username}
              label="Username"
              error={fieldErrors.username}
              hint={creating ? USERNAME_HINT : undefined}
            >
              <input
                id={ids.username}
                name="username"
                type="text"
                inputMode="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                maxLength={32}
                value={username}
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={describedBy(
                  ids.username,
                  fieldErrors.username,
                  creating ? 'hint' : undefined,
                )}
                onChange={(event) => setUsername(event.target.value)}
              />
            </AuthField>

            <AuthField
              id={ids.password}
              label="Password"
              error={fieldErrors.password}
              hint={creating ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
            >
              <div className="auth-password">
                <input
                  id={ids.password}
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  minLength={creating ? MIN_PASSWORD_LENGTH : undefined}
                  value={password}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={describedBy(
                    ids.password,
                    fieldErrors.password,
                    creating ? 'hint' : undefined,
                  )}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="auth-reveal"
                  aria-pressed={showPassword}
                  aria-controls={ids.password}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                  <span className="sr-only"> password</span>
                </button>
              </div>
            </AuthField>

            {showInviteCode && (
              <AuthField id={ids.invite} label="Invite code" error={fieldErrors.inviteCode}>
                <input
                  id={ids.invite}
                  name="invite-code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required={effectiveConfig.invite_code_required}
                  value={inviteCode}
                  aria-invalid={Boolean(fieldErrors.inviteCode)}
                  aria-describedby={describedBy(ids.invite, fieldErrors.inviteCode)}
                  onChange={(event) => setInviteCode(event.target.value)}
                />
              </AuthField>
            )}

            <div className="auth-error-region" aria-live="polite" aria-atomic="true">
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="auth-submit"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting && <Spinner />}
              <span>
                {submitting
                  ? creating
                    ? 'Creating account…'
                    : 'Signing in…'
                  : creating
                    ? 'Create account'
                    : 'Sign in'}
              </span>
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
