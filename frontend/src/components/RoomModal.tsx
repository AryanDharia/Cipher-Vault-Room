import React, { useState, useEffect, useRef } from 'react';
import { Shield, PlusCircle, LogIn, Users, ArrowRight, ChevronDown, ChevronUp, Lock, Info, Check, User, LogOut, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { deriveRoomKey } from '../lib/crypto';

interface RoomModalProps {
  isOpen: boolean;
  user?: { id: string; username: string; role: string } | null;
  onRoomJoined: (roomData: any, roomKey: CryptoKey, passphrase?: string) => void | Promise<void>;
  onLogout?: () => void;
  onOpenDeleteAccount?: () => void;
}

export const RoomModal: React.FC<RoomModalProps> = ({
  isOpen,
  user,
  onRoomJoined,
  onLogout,
  onOpenDeleteAccount,
}) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [passphrase, setPassphrase] = useState('');

  // Simplified UI controls
  const [numHosts, setNumHosts] = useState(2);
  const [maxMembers, setMaxMembers] = useState(10);

  // Advanced Security (Threshold Consensus)
  const [showAdvancedSecurity, setShowAdvancedSecurity] = useState(false);
  const [thresholdReq, setThresholdReq] = useState(2);
  const [thresholdTot, setThresholdTot] = useState(3);
  const [isAdvancedTouched, setIsAdvancedTouched] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
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

  return (
    <div className="fixed inset-0 bg-[#08090e]/95 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none">
      {/* Top Left: Logo / Branding */}
      <div className="absolute top-4 left-4 md:top-6 md:left-8 flex items-center space-x-2.5">
        <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
          <Shield className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-sm font-bold tracking-wider text-white">
            VAULT<span className="text-cyan-400">ROOM</span>
          </span>
          <span className="text-[10px] font-mono text-slate-500 tracking-tight hidden sm:block">
            Zero-Knowledge Collaborative Workspace
          </span>
        </div>
      </div>

      {/* Top Right: User Profile & Details Menu */}
      {user && (
        <div className="absolute top-4 right-4 md:top-6 md:right-8 z-30" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-[#0f111a] hover:bg-[#151926] border border-[#212638] hover:border-cyan-500/40 transition-all shadow-lg"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-950/90 to-cyan-900/40 border border-cyan-700/50 flex items-center justify-center text-cyan-400 shadow-inner">
              <User className="w-4 h-4" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-100 leading-tight">{user.username}</span>
              <span className="text-[10px] font-mono text-cyan-400 uppercase leading-none tracking-wide">
                {user.role || 'Member'}
              </span>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                showUserMenu ? 'rotate-180 text-cyan-400' : ''
              }`}
            />
          </button>

          {/* User Details Dropdown */}
          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl bg-[#0f111a] border border-[#212638] shadow-2xl py-2 z-50 animate-fadeIn divide-y divide-[#212638]/60">
              <div className="px-3.5 py-2.5">
                <div className="flex items-center space-x-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                  <span className="text-xs font-bold text-slate-100">{user.username}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>Role:</span>
                  <span className="text-cyan-400 font-semibold uppercase">{user.role || 'Member'}</span>
                </div>
                {user.id && (
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mt-1">
                    <span>Account ID:</span>
                    <span>{user.id.slice(0, 8)}...</span>
                  </div>
                )}
              </div>

              <div className="py-1">
                {onLogout && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs font-mono text-slate-300 hover:bg-[#1a1f33] hover:text-white flex items-center space-x-2.5 transition-colors"
                  >
                    <LogOut className="w-4 h-4 text-amber-400" />
                    <span>Sign Out</span>
                  </button>
                )}

                {onOpenDeleteAccount && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      onOpenDeleteAccount();
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs font-mono text-red-400 hover:bg-red-950/50 hover:text-red-300 flex items-center space-x-2.5 transition-colors border-t border-[#212638]/40"
                  >
                    <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold">Delete Account</span>
                      <span className="text-[10px] text-red-400/70">Permanently erase user data</span>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-[#0f111a] border border-[#212638] rounded-xl max-w-lg w-full p-6 shadow-2xl animate-fadeIn">
        {/* Modal Header Tabs */}
        <div className="flex items-center space-x-2 border-b border-[#212638] pb-3 mb-4">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex-1 py-1.5 text-xs font-mono font-semibold rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
              mode === 'create'
                ? 'bg-cyan-950/60 border border-cyan-500/60 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Create New Room</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className={`flex-1 py-1.5 text-xs font-mono font-semibold rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
              mode === 'join'
                ? 'bg-cyan-950/60 border border-cyan-500/60 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Join Existing</span>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded bg-red-950/40 border border-red-800/60 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' ? (
            <>
              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">Room Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Series-A Deal Room"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 font-mono"
                />
              </div>

              {/* Simplified Room Configuration: Number of Hosts & Total Members Allowed */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1 flex items-center space-x-1">
                    <Shield className="w-3 h-3 text-cyan-400" />
                    <span>Number of Hosts</span>
                  </label>
                  <select
                    value={numHosts}
                    onChange={(e) => setNumHosts(Number(e.target.value))}
                    className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-2.5 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500/60"
                  >
                    <option value={1}>1 Host (Solo Owner)</option>
                    <option value={2}>2 Hosts (Host + Co-Host)</option>
                    <option value={3}>3 Hosts (Consortium)</option>
                    <option value={5}>5 Hosts (Executive Board)</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Authorized room managers</p>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1 flex items-center space-x-1">
                    <Users className="w-3 h-3 text-emerald-400" />
                    <span>Total Members Allowed</span>
                  </label>
                  <select
                    value={maxMembers}
                    onChange={(e) => setMaxMembers(Number(e.target.value))}
                    className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-2.5 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500/60"
                  >
                    <option value={5}>5 Members (Small Team)</option>
                    <option value={10}>10 Members (Standard)</option>
                    <option value={20}>20 Members (Extended)</option>
                    <option value={50}>50 Members (Department)</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Maximum room capacity</p>
                </div>
              </div>

              {/* Expandable Advanced Security & Quorum Consensus */}
              <div className="rounded-lg border border-[#212638] bg-[#090b12] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSecurity(!showAdvancedSecurity)}
                  className="w-full px-3 py-2 text-left flex items-center justify-between text-xs font-mono text-slate-300 hover:text-white hover:bg-[#121522] transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-semibold">Advanced Security (Threshold Consensus)</span>
                  </div>
                  {showAdvancedSecurity ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>

                {showAdvancedSecurity && (
                  <div className="p-3 border-t border-[#212638] space-y-3 bg-[#0c0e17]">
                    <div className="text-[11px] text-slate-400 leading-relaxed bg-[#121522] p-2.5 rounded border border-[#1f2438]">
                      <p className="font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
                        <Info className="w-3 h-3 text-cyan-400" />
                        <span>M-of-N Cryptographic Approvals</span>
                      </p>
                      Threshold consensus prevents single-person compromise. Unlocking protected documents or sensitive vault secrets requires approval from at least <strong>{thresholdReq}</strong> of <strong>{thresholdTot}</strong> designated key holders.
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-mono text-slate-400 block mb-1">
                          Approvals Needed (M)
                        </label>
                        <select
                          value={thresholdReq}
                          onChange={(e) => {
                            setIsAdvancedTouched(true);
                            setThresholdReq(Number(e.target.value));
                          }}
                          className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none"
                        >
                          <option value={1}>1 Approval (Instant)</option>
                          <option value={2}>2 Approvals (Consensus)</option>
                          <option value={3}>3 Approvals (Majority)</option>
                          <option value={5}>5 Approvals (Strict)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-mono text-slate-400 block mb-1">
                          Eligible Key Holders (N)
                        </label>
                        <select
                          value={thresholdTot}
                          onChange={(e) => {
                            setIsAdvancedTouched(true);
                            setThresholdTot(Number(e.target.value));
                          }}
                          className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none"
                        >
                          <option value={1}>1 Holder</option>
                          <option value={2}>2 Holders</option>
                          <option value={3}>3 Holders</option>
                          <option value={5}>5 Holders</option>
                          <option value={7}>7 Holders</option>
                        </select>
                      </div>
                    </div>

                    {thresholdReq > thresholdTot && (
                      <p className="text-[10px] font-mono text-amber-400 bg-amber-950/40 p-1.5 rounded border border-amber-800/40">
                        Warning: Approvals needed ({thresholdReq}) cannot exceed total eligible holders ({thresholdTot}).
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div>
              <label className="text-[11px] font-mono text-slate-400 block mb-1">6-Character Room Code</label>
              <input
                type="text"
                required
                maxLength={6}
                placeholder="e.g. 7XKM9P"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-3 py-2 text-xs font-mono font-bold tracking-widest text-cyan-400 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 uppercase"
              />
            </div>
          )}

          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1">
              Zero-Knowledge Passphrase <span className="text-cyan-400 text-[10px]">(Client-Side Only)</span>
            </label>
            <input
              type="password"
              required
              placeholder="Shared room decryption passphrase..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Derives local AES-256-GCM key via PBKDF2 with 100,000 rounds. Server never observes your passphrase or key.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs transition-all flex items-center justify-center space-x-1.5 shadow-[0_0_15px_rgba(6,182,212,0.25)]"
          >
            <span>{loading ? 'Initializing Vault...' : mode === 'create' ? 'Create Secure Room' : 'Join Room'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
