import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  LockKeyhole,
  ShieldCheck,
  UserRound,
  Eye,
  EyeOff,
  Shield,
  KeyRound,
  Lock,
  Cpu
} from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
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
      {/* Background with user-provided artwork & dark overlay */}
      <div className="cyber-bg-container" aria-hidden="true">
        <div className="cyber-bg-overlay" />
      </div>

      <div className="vr-auth__ambient" aria-hidden="true">
        <span className="vr-auth__orb vr-auth__orb--cyan" />
        <span className="vr-auth__orb vr-auth__orb--emerald" />
        <span className="vr-auth__grid" />
      </div>

      <section className="vr-auth__layout" aria-label="VaultRoom authentication">
        {/* Left Side: Brand Story & Security Badging */}
        <aside className="vr-auth__story">
          <div className="vr-auth__brand">
            <div className="vr-auth__brand-icon">
              <Shield className="w-5 h-5 text-[#21d4e5]" />
            </div>
            <div className="vr-auth__brand-text">
              <span className="vr-auth__brand-name">VAULT<span>ROOM</span></span>
              <span className="vr-auth__brand-badge">AES-256 E2EE</span>
            </div>
          </div>

          <div className="vr-auth__story-copy">
            <p className="vr-auth__kicker">
              <span className="vr-auth__kicker-dot" /> ZERO-KNOWLEDGE PROTOCOL
            </p>
            <h1>Confidential<br /><em>Workspace.</em></h1>
            <p className="vr-auth__lede">
              Next-generation cryptographic collaboration. Your documents and secret vaults are client-side encrypted before transmission.
            </p>
          </div>

          <ul className="vr-auth__highlights" aria-label="VaultRoom security guarantees">
            <li>
              <span><Check size={14} aria-hidden="true" /></span>
              <div>
                <strong>Zero-Knowledge Encryption</strong>
                <p>Client-derived keys never leave your browser device.</p>
              </div>
            </li>
            <li>
              <span><Check size={14} aria-hidden="true" /></span>
              <div>
                <strong>Quorum-Protected Vaults</strong>
                <p>Multi-party consensus required for sensitive actions.</p>
              </div>
            </li>
            <li>
              <span><Check size={14} aria-hidden="true" /></span>
              <div>
                <strong>Real-Time Encrypted Yjs</strong>
                <p>Collaborative TipTap editor with automated state synchronization.</p>
              </div>
            </li>
          </ul>

          <div className="vr-auth__story-foot">
            <ShieldCheck size={15} aria-hidden="true" className="text-[#10bfa5]" />
            <span>AUTHENTICATED CRYPTOGRAPHIC ENCLAVE</span>
          </div>
        </aside>

        {/* Right Side: Authentication Panel */}
        <section className="vr-auth__panel" aria-labelledby="vr-auth-heading">
          <div className="vr-auth__panel-top">
            <span className="vr-auth__secure-mark">
              <LockKeyhole size={14} aria-hidden="true" /> SECURE SESSION
            </span>
            <span className="vr-auth__panel-index">
              <Cpu size={13} className="inline mr-1 text-[#10bfa5]" /> ENCLAVE V2.4
            </span>
          </div>

          <div className="vr-auth__heading" key={mode}>
            <p>{isSignUp ? 'REGISTER CREDENTIALS' : 'VERIFY IDENTITY'}</p>
            <h2 id="vr-auth-heading">{isSignUp ? 'Create Vault Account' : 'Welcome to VaultRoom'}</h2>
            <span>{isSignUp ? 'Initialize your cryptographic credentials.' : 'Authenticate to unlock your encrypted workspaces.'}</span>
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
            >
              Sign In
            </button>
            <button
              id="vr-signup-tab"
              type="button"
              aria-pressed={isSignUp}
              aria-controls="vr-auth-form-panel"
              className={isSignUp ? 'is-active' : ''}
              disabled={loading}
              onClick={() => switchMode('signup')}
            >
              Sign Up
            </button>
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
                  <UserRound size={17} aria-hidden="true" className="vr-auth__icon" />
                  <input
                    id="vr-auth-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    minLength={3}
                    maxLength={50}
                    placeholder="e.g. sec_operator"
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
                  <KeyRound size={17} aria-hidden="true" className="vr-auth__icon" />
                  <input
                    id="vr-auth-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    aria-describedby={isSignUp ? 'vr-auth-password-hint' : undefined}
                    minLength={isSignUp ? 6 : 1}
                    placeholder="Enter passphrase"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={loading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="vr-auth__visibility-btn"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {isSignUp && (
                  <span className="vr-auth__hint" id="vr-auth-password-hint">
                    Minimum 6 characters. Used to salt your authorization token.
                  </span>
                )}
              </div>

              {error && <div className="vr-auth__error" role="alert">{error}</div>}

              <button className="vr-auth__submit" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <span className="vr-auth__spinner" aria-hidden="true" />
                    <span aria-live="polite">{isSignUp ? 'Creating account…' : 'Authenticating…'}</span>
                  </>
                ) : (
                  <>
                    <span>{isSignUp ? 'Create Encrypted Account' : 'Authenticate & Unlock'}</span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          </div>

          <footer className="vr-auth__footer">
            <span><Lock size={12} aria-hidden="true" /> TLS 1.3 · End-to-End Encrypted</span>
            <span>VAULTROOM <b>·</b> SECURE ENCLAVE</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
