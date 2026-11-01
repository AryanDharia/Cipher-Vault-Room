import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import './auth-switch.css';

export type AuthMode = 'signin' | 'signup';

interface AuthSwitchProps {
  onAuthenticate: (mode: AuthMode, username: string, password: string) => Promise<void>;
  notification?: string | null;
}

export default function AuthSwitch({ onAuthenticate, notification }: AuthSwitchProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const isSignUp = mode === 'signup';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError('Please enter your username and password.');
      return;
    }

    submitting.current = true;
    setLoading(true);
    setError('');
    try {
      await onAuthenticate(mode, normalizedUsername, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    if (loading || nextMode === mode) return;
    setMode(nextMode);
    setError('');
    setPassword('');
  }

  return (
    <main className="vr-auth">
      <div className="vr-auth__ambient" aria-hidden="true">
        <span className="vr-auth__orb vr-auth__orb--cyan" />
        <span className="vr-auth__orb vr-auth__orb--teal" />
        <span className="vr-auth__grid" />
      </div>

      <section className="vr-auth__layout" aria-label="VaultRoom authentication">
        <aside className="vr-auth__story">
          <div className="vr-auth__brand">
            <span className="vr-auth__brand-mark" aria-hidden="true">V</span>
            <span className="vr-auth__brand-name">VAULT<span>ROOM</span></span>
          </div>

          <div className="vr-auth__story-copy">
            <p className="vr-auth__kicker"><span /> PRIVATE BY DESIGN</p>
            <h1>Your work.<br /><em>Your space.</em></h1>
            <p className="vr-auth__lede">
              A secure space to collaborate and manage documents.
            </p>
          </div>

          <ul className="vr-auth__highlights" aria-label="VaultRoom features">
            <li><span><Check size={14} aria-hidden="true" /></span> Private rooms</li>
            <li><span><Check size={14} aria-hidden="true" /></span> Secure document sharing</li>
            <li><span><Check size={14} aria-hidden="true" /></span> Real-time collaboration</li>
          </ul>

          <div className="vr-auth__story-foot">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>SECURE COLLABORATION, SIMPLIFIED</span>
          </div>
        </aside>

        <section className="vr-auth__panel" aria-labelledby="vr-auth-heading">
          <div className="vr-auth__panel-top">
            <span className="vr-auth__secure-mark"><LockKeyhole size={15} aria-hidden="true" /> SECURE ACCESS</span>
            <span className="vr-auth__panel-index">01 <i /> 02</span>
          </div>

          <div className="vr-auth__heading" key={mode}>
            <p>{isSignUp ? 'YOUR WORKSPACE STARTS HERE' : 'GOOD TO HAVE YOU BACK'}</p>
            <h2 id="vr-auth-heading">{isSignUp ? 'Create your account' : 'Welcome back'}</h2>
            <span>{isSignUp ? 'Set up your VaultRoom account to get started.' : 'Sign in to continue to your workspace.'}</span>
          </div>

          {notification && (
            <div className="vr-auth__notice" role="status">
              <span aria-hidden="true" />{notification}
            </div>
          )}

          <div className="vr-auth__tabs" role="group" aria-label="Authentication options">
            <button
              id="vr-signin-tab"
              type="button"
              aria-pressed={!isSignUp}
              aria-controls="vr-auth-form-panel"
              className={!isSignUp ? 'is-active' : ''}
              disabled={loading}
              onClick={() => switchMode('signin')}
            >Sign In</button>
            <button
              id="vr-signup-tab"
              type="button"
              aria-pressed={isSignUp}
              aria-controls="vr-auth-form-panel"
              className={isSignUp ? 'is-active' : ''}
              disabled={loading}
              onClick={() => switchMode('signup')}
            >Sign Up</button>
            <span className={`vr-auth__tab-indicator${isSignUp ? ' is-right' : ''}`} aria-hidden="true" />
          </div>

          <div
            id="vr-auth-form-panel"
            className="vr-auth__form-wrap"
            key={`form-${mode}`}
          >
            <form onSubmit={handleSubmit} aria-busy={loading} noValidate={false}>
              <div className="vr-auth__field">
                <label htmlFor="vr-auth-username">Username</label>
                <div className="vr-auth__input-wrap">
                  <UserRound size={17} aria-hidden="true" />
                  <input
                    id="vr-auth-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    minLength={3}
                    maxLength={50}
                    placeholder="Your username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </div>

              <div className="vr-auth__field">
                <label htmlFor="vr-auth-password">Password</label>
                <div className="vr-auth__input-wrap">
                  <LockKeyhole size={17} aria-hidden="true" />
                  <input
                    id="vr-auth-password"
                    name="password"
                    type="password"
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    aria-describedby={isSignUp ? 'vr-auth-password-hint' : undefined}
                    minLength={isSignUp ? 6 : 1}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                {isSignUp && <span className="vr-auth__hint" id="vr-auth-password-hint">Use at least 6 characters.</span>}
              </div>

              {error && <div className="vr-auth__error" role="alert">{error}</div>}

              <button className="vr-auth__submit" type="submit" disabled={loading}>
                {loading ? (
                  <><span className="vr-auth__spinner" aria-hidden="true" /><span aria-live="polite">{isSignUp ? 'Creating account…' : 'Signing in…'}</span></>
                ) : (
                  <>{isSignUp ? 'Create account' : 'Sign in'}<ArrowRight size={17} aria-hidden="true" /></>
                )}
              </button>
            </form>
          </div>

          <footer className="vr-auth__footer">
            <span><LockKeyhole size={12} aria-hidden="true" /> Your access is protected</span>
            <span>VAULTROOM <b>·</b> PRIVATE WORKSPACE</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
