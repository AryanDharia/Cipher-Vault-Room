import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  ShieldCheck,
  PlusCircle,
  LogIn,
  Users,
  ArrowRight,
  ChevronDown,
  LockKeyhole,
  Info,
  User,
  LogOut,
  Trash2,
  KeyRound,
  FileText,
  AlertTriangle,
  Eye,
  EyeOff,
  Cpu
} from 'lucide-react';
import { api } from '../lib/api';
import { deriveRoomKey } from '../lib/crypto';
import './room-modal.css';

interface RoomModalProps {
  isOpen: boolean;
  user?: { id: string; username: string; role: string } | null;
  onRoomJoined: (roomData: any, roomKey: CryptoKey, passphrase?: string) => void | Promise<void>;
  onLogout?: () => void;
  onOpenDeleteAccount?: () => void;
  initialMode?: 'create' | 'join';
  defaultShowAdvanced?: boolean;
  defaultShowUserMenu?: boolean;
}

export const RoomModal: React.FC<RoomModalProps> = ({
  isOpen,
  user,
  onRoomJoined,
  onLogout,
  onOpenDeleteAccount,
  initialMode = 'create',
  defaultShowAdvanced = false,
  defaultShowUserMenu = false,
}) => {
  const [mode, setMode] = useState<'create' | 'join'>(initialMode);
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Simplified UI controls
  const [numHosts, setNumHosts] = useState(2);
  const [maxMembers, setMaxMembers] = useState(10);

  // Advanced Security (Threshold Consensus)
  const [showAdvancedSecurity, setShowAdvancedSecurity] = useState(defaultShowAdvanced);
  const [thresholdReq, setThresholdReq] = useState(2);
  const [thresholdTot, setThresholdTot] = useState(3);
  const [isAdvancedTouched, setIsAdvancedTouched] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(defaultShowUserMenu);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Synchronize simplified "Number of Hosts" with underlying threshold quorum unless user customized advanced settings
  useEffect(() => {
    if (!isAdvancedTouched) {
      if (numHosts === 1) {
        setThresholdReq(1);
        setThresholdTot(1);
      } else if (numHosts === 2) {
        setThresholdReq(2);
        setThresholdTot(3);
      } else {
        setThresholdReq(2);
        setThresholdTot(numHosts);
      }
    }
  }, [numHosts, isAdvancedTouched]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!passphrase.trim()) {
        throw new Error('Room passphrase is required for client-side zero-knowledge key derivation');
      }

      if (mode === 'create') {
        // Validation of quorum and member limits
        if (numHosts > maxMembers) {
          throw new Error(`Number of hosts (${numHosts}) cannot exceed total members allowed (${maxMembers})`);
        }
        if (thresholdReq > thresholdTot) {
          throw new Error(`Approval threshold (${thresholdReq}) cannot exceed eligible key holders (${thresholdTot})`);
        }
        if (thresholdTot > maxMembers) {
          throw new Error(`Eligible key holders (${thresholdTot}) cannot exceed total members allowed (${maxMembers})`);
        }

        const res = await api.createRoom({
          name: roomName.trim() || 'Confidential Financial Vault',
          num_hosts: numHosts,
          max_members: maxMembers,
          threshold_required: thresholdReq,
          threshold_total: thresholdTot,
        });

        const activeCode = res.code || res.room?.code;
        // Derive client-side zero-knowledge AES-256-GCM key
        const { key } = await deriveRoomKey(passphrase.trim(), activeCode);

        await onRoomJoined(
          {
            room: res.room || res,
            current_user_role: res.current_user_role || 'owner',
            members: res.members || [],
            online_users: res.online_users || [],
          },
          key,
          passphrase.trim()
        );
      } else {
        const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (cleanCode.length !== 6) {
          throw new Error('Room code must be exactly 6 characters');
        }

        const res = await api.joinRoom({ code: cleanCode, role: 'editor' });
        const { key } = await deriveRoomKey(passphrase.trim(), cleanCode);

        await onRoomJoined(res, key, passphrase.trim());
      }
    } catch (err: any) {
      setError(err.message || 'Failed to process room action');
    } finally {
      setLoading(false);
    }
  };

  const isCreate = mode === 'create';

  return (
    <div className="vr-room" role="dialog" aria-modal="true" aria-labelledby="vr-room-heading">
      {/* Background with user-provided artwork & dark overlay */}
      <div className="cyber-bg-container pointer-events-none" aria-hidden="true">
        <div className="cyber-bg-overlay pointer-events-none" />
      </div>

      {/* Ambient Cyber Grid & Floating Radiant Orbs */}
      <div className="vr-room__ambient" aria-hidden="true">
        <span className="vr-room__orb vr-room__orb--cyan" />
        <span className="vr-room__orb vr-room__orb--emerald" />
        <span className="vr-room__grid" />
      </div>

      {/* Top Header Bar */}
      <header className="vr-room__top-bar">
        {/* Brand Identity */}
        <div className="vr-room__brand">
          <div className="vr-room__brand-mark" aria-hidden="true">
            <Shield className="w-5 h-5 text-[#21d4e5]" />
          </div>
          <div className="vr-room__brand-text">
            <span className="vr-room__brand-name">VAULT<span>ROOM</span></span>
            <span className="vr-room__brand-tag">ZERO-KNOWLEDGE ENCLAVE</span>
          </div>
        </div>

        {/* Top Right User Profile Menu */}
        {user && (
          <div className="vr-room__user-area" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="vr-room__user-pill"
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              aria-label="User account menu"
            >
              <div className="vr-room__user-avatar" aria-hidden="true">
                <User size={15} />
              </div>
              <div className="vr-room__user-info">
                <span className="vr-room__user-name">{user.username}</span>
                <span className="vr-room__user-role">{user.role || 'Member'}</span>
              </div>
              <ChevronDown size={14} className="vr-room__user-chevron" aria-hidden="true" />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div className="vr-room__user-dropdown" role="menu">
                <div className="vr-room__dropdown-header">
                  <div className="vr-room__dropdown-user-row">
                    <span className="vr-room__dropdown-dot" aria-hidden="true" />
                    <span className="vr-room__dropdown-username">{user.username}</span>
                  </div>
                  <div className="vr-room__dropdown-meta">
                    <span>Role:</span>
                    <span className="vr-room__dropdown-role">{user.role || 'Member'}</span>
                  </div>
                  {user.id && (
                    <div className="vr-room__dropdown-meta" style={{ marginTop: '2px', color: '#91a4a7' }}>
                      <span>ID:</span>
                      <span>{user.id.slice(0, 8)}…</span>
                    </div>
                  )}
                </div>

                <div className="vr-room__dropdown-actions">
                  {onLogout && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowUserMenu(false);
                        onLogout();
                      }}
                      className="vr-room__dropdown-btn"
                    >
                      <LogOut size={14} style={{ color: '#f59e0b' }} aria-hidden="true" />
                      <span>Sign Out</span>
                    </button>
                  )}

                  {onOpenDeleteAccount && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowUserMenu(false);
                        onOpenDeleteAccount();
                      }}
                      className="vr-room__dropdown-btn vr-room__dropdown-btn--danger"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <div className="vr-room__dropdown-danger-copy">
                        <span>Delete Account</span>
                        <span className="vr-room__dropdown-danger-hint">Permanently erase data</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Center Modal Card */}
      <section className="vr-room__card">
        {/* Subtle Vault Mechanism Watermark */}
        <svg
          className="vr-room__watermark"
          viewBox="0 0 300 300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="150" cy="150" r="140" stroke="currentColor" strokeWidth="1" strokeDasharray="4 6" opacity="0.3" />
          <circle cx="150" cy="150" r="115" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          <circle cx="150" cy="150" r="85" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          <circle cx="150" cy="150" r="50" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 4" opacity="0.7" />
          <path d="M150 10 V35 M150 265 V290 M10 150 H35 M265 150 H290" stroke="currentColor" strokeWidth="2" opacity="0.5" />
          <path d="M51 51 L68 68 M232 232 L249 249 M51 249 L68 232 M232 68 L249 51" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
          <rect x="135" y="130" width="30" height="36" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.8" />
          <path d="M141 130 V122 C141 117 145 113 150 113 C155 113 159 117 159 122 V130" stroke="currentColor" strokeWidth="2" opacity="0.8" />
          <circle cx="150" cy="145" r="3" fill="currentColor" opacity="0.8" />
          <path d="M150 148 V155" stroke="currentColor" strokeWidth="2" opacity="0.8" />
        </svg>

        {/* Card Top Row: Security Tag & Index */}
        <div className="vr-room__card-top">
          <span className="vr-room__secure-mark">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Secure Workspace Gateway</span>
          </span>
          <span className="vr-room__card-index">
            <Cpu size={12} className="inline mr-1 text-[#10bfa5]" /> STEP {isCreate ? '01' : '02'}
          </span>
        </div>

        {/* Dynamic Heading based on mode */}
        <div className="vr-room__heading" key={mode}>
          <p className="vr-room__heading-kicker">
            {isCreate ? 'INITIALIZE SECURE VAULT' : 'VERIFIED PARTICIPATION'}
          </p>
          <h2 id="vr-room-heading" className="vr-room__heading-title">
            {isCreate ? 'Create New Room' : 'Join Existing Room'}
          </h2>
          <span className="vr-room__heading-subtitle">
            {isCreate
              ? 'Deploy a zero-knowledge encrypted room with custom host consensus.'
              : 'Enter your 6-character room code and client-side encryption passphrase.'}
          </span>
        </div>

        {/* Segmented Tab Selector */}
        <div className="vr-room__tabs" role="tablist" aria-label="Room access options">
          <button
            type="button"
            role="tab"
            aria-selected={isCreate}
            className={`vr-room__tab ${isCreate ? 'is-active' : ''}`}
            disabled={loading}
            onClick={() => {
              if (loading) return;
              setMode('create');
              setError(null);
            }}
          >
            <PlusCircle size={15} aria-hidden="true" />
            <span>Create New Room</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isCreate}
            className={`vr-room__tab ${!isCreate ? 'is-active' : ''}`}
            disabled={loading}
            onClick={() => {
              if (loading) return;
              setMode('join');
              setError(null);
            }}
          >
            <LogIn size={15} aria-hidden="true" />
            <span>Join Existing</span>
          </button>
        </div>

        {/* Error Alert Banner */}
        {error && (
          <div className="vr-room__error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="vr-room__form">
          {isCreate ? (
            <>
              {/* Room Name */}
              <div className="vr-room__field">
                <div className="vr-room__label-row">
                  <label htmlFor="vr-room-name" className="vr-room__label">
                    <span>Room Name</span>
                  </label>
                </div>
                <div className="vr-room__input-wrap">
                  <FileText size={16} aria-hidden="true" />
                  <input
                    id="vr-room-name"
                    type="text"
                    required
                    disabled={loading}
                    placeholder="e.g. Confidential Project Vault"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* Responsive 2-Column Grid: Hosts & Capacity */}
              <div className="vr-room__grid-two">
                {/* Number of Hosts */}
                <div className="vr-room__field">
                  <div className="vr-room__label-row">
                    <label htmlFor="vr-num-hosts" className="vr-room__label">
                      <ShieldCheck size={13} style={{ color: 'var(--vr-cyan)' }} aria-hidden="true" />
                      <span>Number of Hosts</span>
                    </label>
                  </div>
                  <div className="vr-room__select-wrap">
                    <Shield className="vr-room__select-icon" size={15} aria-hidden="true" />
                    <select
                      id="vr-num-hosts"
                      value={numHosts}
                      onChange={(e) => setNumHosts(Number(e.target.value))}
                      disabled={loading}
                      className="vr-room__select"
                    >
                      <option value={1}>1 Host (Solo Owner)</option>
                      <option value={2}>2 Hosts (Host + Co-Host)</option>
                      <option value={3}>3 Hosts (Consortium)</option>
                      <option value={5}>5 Hosts (Executive Board)</option>
                    </select>
                    <ChevronDown className="vr-room__select-chevron" size={14} aria-hidden="true" />
                  </div>
                  <span className="vr-room__field-hint">Authorized room managers</span>
                </div>

                {/* Total Members Allowed */}
                <div className="vr-room__field">
                  <div className="vr-room__label-row">
                    <label htmlFor="vr-max-members" className="vr-room__label">
                      <Users size={13} style={{ color: 'var(--vr-emerald)' }} aria-hidden="true" />
                      <span>Total Members Allowed</span>
                    </label>
                  </div>
                  <div className="vr-room__select-wrap">
                    <Users className="vr-room__select-icon" size={15} aria-hidden="true" />
                    <select
                      id="vr-max-members"
                      value={maxMembers}
                      onChange={(e) => setMaxMembers(Number(e.target.value))}
                      disabled={loading}
                      className="vr-room__select"
                    >
                      <option value={5}>5 Members (Small Team)</option>
                      <option value={10}>10 Members (Standard)</option>
                      <option value={20}>20 Members (Extended)</option>
                      <option value={50}>50 Members (Department)</option>
                    </select>
                    <ChevronDown className="vr-room__select-chevron" size={14} aria-hidden="true" />
                  </div>
                  <span className="vr-room__field-hint">Maximum room capacity</span>
                </div>
              </div>

              {/* Advanced Security Disclosure Panel (Threshold Consensus) */}
              <div className="vr-room__advanced">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSecurity(!showAdvancedSecurity)}
                  aria-expanded={showAdvancedSecurity}
                  className="vr-room__advanced-toggle"
                >
                  <div className="vr-room__advanced-title-group">
                    <LockKeyhole size={14} aria-hidden="true" />
                    <span>Advanced Security (Threshold Consensus)</span>
                    <span className="vr-room__advanced-badge">
                      {thresholdReq}-of-{thresholdTot} Quorum
                    </span>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`vr-room__advanced-chevron ${showAdvancedSecurity ? 'is-open' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {showAdvancedSecurity && (
                  <div className="vr-room__advanced-body">
                    <div className="vr-room__advanced-info">
                      <Info size={15} aria-hidden="true" />
                      <div>
                        <strong style={{ color: '#f2f7f7', display: 'block', marginBottom: '2px' }}>
                          M-of-N Cryptographic Approvals
                        </strong>
                        Threshold consensus prevents single-person compromise. Unlocking protected documents or sensitive vault secrets requires approval from at least <strong>{thresholdReq}</strong> of <strong>{thresholdTot}</strong> designated key holders.
                      </div>
                    </div>

                    <div className="vr-room__grid-two">
                      <div className="vr-room__field">
                        <label htmlFor="vr-threshold-req" className="vr-room__label">
                          Approvals Needed (M)
                        </label>
                        <div className="vr-room__select-wrap">
                          <select
                            id="vr-threshold-req"
                            value={thresholdReq}
                            onChange={(e) => {
                              setIsAdvancedTouched(true);
                              setThresholdReq(Number(e.target.value));
                            }}
                            disabled={loading}
                            className="vr-room__select"
                          >
                            <option value={1}>1 Approval (Instant)</option>
                            <option value={2}>2 Approvals (Consensus)</option>
                            <option value={3}>3 Approvals (Majority)</option>
                            <option value={5}>5 Approvals (Strict)</option>
                          </select>
                          <ChevronDown className="vr-room__select-chevron" size={14} aria-hidden="true" />
                        </div>
                      </div>

                      <div className="vr-room__field">
                        <label htmlFor="vr-threshold-tot" className="vr-room__label">
                          Eligible Key Holders (N)
                        </label>
                        <div className="vr-room__select-wrap">
                          <select
                            id="vr-threshold-tot"
                            value={thresholdTot}
                            onChange={(e) => {
                              setIsAdvancedTouched(true);
                              setThresholdTot(Number(e.target.value));
                            }}
                            disabled={loading}
                            className="vr-room__select"
                          >
                            <option value={1}>1 Holder</option>
                            <option value={2}>2 Holders</option>
                            <option value={3}>3 Holders</option>
                            <option value={5}>5 Holders</option>
                            <option value={7}>7 Holders</option>
                          </select>
                          <ChevronDown className="vr-room__select-chevron" size={14} aria-hidden="true" />
                        </div>
                      </div>
                    </div>

                    {thresholdReq > thresholdTot && (
                      <div className="vr-room__advanced-warning" role="alert">
                        Warning: Approvals needed ({thresholdReq}) cannot exceed total eligible holders ({thresholdTot}).
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Join Room Mode: 6-Character Room Code */
            <div className="vr-room__field">
              <div className="vr-room__label-row">
                <label htmlFor="vr-room-code" className="vr-room__label">
                  <KeyRound size={13} style={{ color: 'var(--vr-cyan)' }} aria-hidden="true" />
                  <span>6-Character Room Code</span>
                </label>
                <span className="vr-room__label-badge">ALPHANUMERIC</span>
              </div>
              <div className="vr-room__input-wrap">
                <KeyRound size={16} aria-hidden="true" />
                <input
                  id="vr-room-code"
                  type="text"
                  required
                  maxLength={6}
                  disabled={loading}
                  placeholder="e.g. 7XKM9P"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  className="vr-room__input-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
              <span className="vr-room__field-hint">
                Enter the exact 6-character room code provided by the room host.
              </span>
            </div>
          )}

          {/* Zero-Knowledge Passphrase (Shared by both modes) */}
          <div className="vr-room__field">
            <div className="vr-room__label-row">
              <label htmlFor="vr-room-passphrase" className="vr-room__label">
                <LockKeyhole size={13} style={{ color: 'var(--vr-emerald)' }} aria-hidden="true" />
                <span>Zero-Knowledge Passphrase</span>
              </label>
              <span className="vr-room__label-badge">CLIENT-SIDE ONLY</span>
            </div>
            <div className="vr-room__input-wrap">
              <LockKeyhole size={16} aria-hidden="true" />
              <input
                id="vr-room-passphrase"
                type={showPassphrase ? 'text' : 'password'}
                required
                disabled={loading}
                placeholder="Shared room decryption passphrase..."
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="vr-room__visibility-btn"
                title={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <span className="vr-room__field-hint">
              Derives local AES-256-GCM key via PBKDF2 with 100,000 rounds. Server never observes your passphrase or key.
            </span>
          </div>

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={loading}
            className="vr-room__submit"
          >
            {loading ? (
              <>
                <span className="vr-room__spinner" aria-hidden="true" />
                <span>{isCreate ? 'Initializing Vault Enclave...' : 'Authenticating to Room...'}</span>
              </>
            ) : (
              <>
                <span>{isCreate ? 'Deploy Secure Room' : 'Join Encrypted Room'}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        {/* Card Footer */}
        <footer className="vr-room__footer">
          <div className="vr-room__footer-left">
            <LockKeyhole size={12} aria-hidden="true" />
            <span>End-to-End Encrypted · Zero-Knowledge</span>
          </div>
          <div className="vr-room__footer-right">
            <span>AES-256-GCM · PBKDF2</span>
          </div>
        </footer>
      </section>
    </div>
  );
};
