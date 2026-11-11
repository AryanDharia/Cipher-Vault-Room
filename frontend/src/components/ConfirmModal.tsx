import React, { useState } from 'react';
import { AlertTriangle, Trash2, LogOut, X, Lock, ShieldAlert, Settings } from 'lucide-react';

interface SignOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  hasUnsavedChanges?: boolean;
}

export const SignOutModal: React.FC<SignOutModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  hasUnsavedChanges = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[70] p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border border-amber-500/30 rounded-2xl max-w-md w-full p-6 shadow-[0_12px_45px_rgba(0,0,0,0.8)] backdrop-blur-xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="bg-gradient-to-r from-amber-500/40 via-amber-400/20 to-transparent h-[1px] absolute top-0 left-0 right-0" />
        
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-mono font-bold text-slate-100">Sign Out Session</h2>
              <p className="text-[11px] font-mono text-slate-400">VaultRoom Security Protocol</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300 font-sans leading-relaxed mb-4">
          Are you sure you want to conclude your authenticated VaultRoom session? Your active encryption keys will be purged from local memory.
        </p>

        {hasUnsavedChanges && (
          <div className="mb-4 p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/35 flex items-start space-x-3 text-xs text-amber-300/95 font-mono">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>Warning: You have uncommitted document changes. Signing out now will discard unsaved state.</span>
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[rgba(100,220,205,0.16)] bg-[#0F171B] text-xs font-mono text-slate-300 hover:bg-[#152329] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-xs font-mono font-bold text-slate-950 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteRoomModalProps {
  isOpen: boolean;
  roomCode: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const DeleteRoomModal: React.FC<DeleteRoomModalProps> = ({
  isOpen,
  roomCode,
  onClose,
  onConfirm,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[70] p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border border-red-500/35 rounded-2xl max-w-md w-full p-6 shadow-[0_12px_45px_rgba(0,0,0,0.8)] backdrop-blur-xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="bg-gradient-to-r from-red-500/40 via-rose-500/20 to-transparent h-[1px] absolute top-0 left-0 right-0" />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-mono font-bold text-red-200">Delete Room Permanently</h2>
              <p className="text-[11px] font-mono text-red-400/80">Irreversible Host Action</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 text-xs text-slate-300 space-y-2.5">
          <p className="leading-relaxed">
            You are about to permanently destroy room{' '}
            <span className="font-mono font-bold text-[#21D4E5] bg-[#05090B] px-2 py-0.5 rounded border border-[#21D4E5]/30">
              {roomCode}
            </span>.
          </p>
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/25 text-red-300/90 text-[11px] font-mono leading-relaxed space-y-1">
            <span className="font-bold text-red-300 block mb-1">CONSEQUENCES:</span>
            <div>• All saved zero-knowledge encrypted documents will be destroyed.</div>
            <div>• Secrets, sources, approvals, and activity history will be erased.</div>
            <div>• All connected room members will be immediately disconnected.</div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[rgba(100,220,205,0.16)] bg-[#0F171B] text-xs font-mono text-slate-300 hover:bg-[#152329] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-xs font-mono font-bold text-white transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] flex items-center space-x-1.5"
          >
            {loading ? (
              <span>Destroying Room...</span>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Room</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteAccountModalProps {
  isOpen: boolean;
  username: string;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
}

export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
  isOpen,
  username,
  onClose,
  onConfirm,
}) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Password is required to confirm deletion');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onConfirm(password);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete account. Please verify your password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[70] p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border border-red-500/35 rounded-2xl max-w-md w-full p-6 shadow-[0_12px_45px_rgba(0,0,0,0.8)] backdrop-blur-xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="bg-gradient-to-r from-red-500/40 via-rose-500/20 to-transparent h-[1px] absolute top-0 left-0 right-0" />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-mono font-bold text-red-200">Delete Account Permanently</h2>
              <p className="text-[11px] font-mono text-red-400/80">Permanent Cryptographic Erasure</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 text-xs text-slate-300 space-y-2.5">
          <p className="leading-relaxed">
            You are about to permanently delete the user account for{' '}
            <span className="font-bold text-white font-mono">{username}</span>.
          </p>
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/25 text-red-300/90 text-[11px] font-mono leading-relaxed space-y-1">
            <span className="font-bold text-red-300 block mb-1">DATA ERASURE NOTICE:</span>
            <div>• Your user credentials and account profile will be permanently removed.</div>
            <div>• All rooms created by you and their stored documents will be deleted.</div>
            <div>• This action is immediate, final, and cannot be undone.</div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1.5">
              Enter your password to authorize deletion:
            </label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                disabled={loading}
                placeholder="Account password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#05090B] border border-red-500/25 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30 font-mono transition-all placeholder:text-slate-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[rgba(100,220,205,0.16)] bg-[#0F171B] text-xs font-mono text-slate-300 hover:bg-[#152329] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-xs font-mono font-bold text-white transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] flex items-center space-x-1.5"
            >
              {loading ? (
                <span>Erasing Account...</span>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Permanently Delete</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface KickMemberModalProps {
  isOpen: boolean;
  targetUsername: string;
  roomCode: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export const KickMemberModal: React.FC<KickMemberModalProps> = ({
  isOpen,
  targetUsername,
  roomCode,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('Administrative removal by host');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onConfirm(reason.trim() || 'Removed by room host');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[70] p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border border-amber-500/35 rounded-2xl max-w-md w-full p-6 shadow-[0_12px_45px_rgba(0,0,0,0.8)] backdrop-blur-xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="bg-gradient-to-r from-amber-500/40 via-amber-400/20 to-transparent h-[1px] absolute top-0 left-0 right-0" />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-mono font-bold text-slate-100">Revoke Member Access</h2>
              <p className="text-[11px] font-mono text-amber-400/80">Room Access Policy</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300 mb-3.5 leading-relaxed font-sans">
          Are you sure you want to remove <span className="font-bold text-amber-300 font-mono">{targetUsername}</span> from room <span className="font-mono text-[#21D4E5] font-bold">{roomCode}</span>?
        </p>

        <div className="p-3.5 rounded-xl bg-amber-950/25 border border-amber-500/25 text-amber-200/90 text-xs font-mono mb-4 space-y-1">
          <div>• The user will be immediately disconnected from the WebSocket session.</div>
          <div>• Active presence, live cursors, and room access will be revoked.</div>
          <div>• They cannot rejoin using stale authentication credentials.</div>
          <div className="text-slate-400 pt-1">• Note: Their personal account profile is unaffected.</div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1.5">
              Reason for Removal (Visible to Member)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Session concluded / Policy violation"
              className="w-full bg-[#05090B] border border-[rgba(100,220,205,0.18)] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 font-mono transition-all"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[rgba(100,220,205,0.16)] bg-[#0F171B] text-xs font-mono text-slate-300 hover:bg-[#152329] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-xs font-mono font-bold text-white transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] flex items-center space-x-1.5"
            >
              {loading ? <span>Revoking...</span> : <span>Confirm Removal</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface RoomSettingsModalProps {
  isOpen: boolean;
  roomCode: string;
  currentName: string;
  currentMaxMembers: number;
  onClose: () => void;
  onConfirm: (settings: { name?: string; max_members?: number }) => Promise<void>;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isOpen,
  roomCode,
  currentName,
  currentMaxMembers,
  onClose,
  onConfirm,
}) => {
  const [name, setName] = useState(currentName);
  const [maxMembers, setMaxMembers] = useState(currentMaxMembers || 10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onConfirm({ name: name.trim(), max_members: Number(maxMembers) });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[70] p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border border-[#21D4E5]/30 rounded-2xl max-w-md w-full p-6 shadow-[0_12px_45px_rgba(0,0,0,0.8)] backdrop-blur-xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="bg-gradient-to-r from-[#10BFA5]/40 via-[#21D4E5]/30 to-transparent h-[1px] absolute top-0 left-0 right-0" />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#10BFA5]/10 border border-[#10BFA5]/30 flex items-center justify-center text-[#21D4E5] shadow-[0_0_15px_rgba(33,212,229,0.2)]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-mono font-bold text-slate-100 flex items-center space-x-2">
                <span>Room Settings:</span>
                <span className="text-[#21D4E5]">{roomCode}</span>
              </h2>
              <p className="text-[11px] font-mono text-slate-400">Vault Configuration & Capacity</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1.5">Room Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#05090B] border border-[rgba(100,220,205,0.18)] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-[#21D4E5] focus:ring-1 focus:ring-[#21D4E5]/30 font-mono transition-all"
            />
          </div>

          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1.5">
              Maximum Member Capacity
            </label>
            <select
              value={maxMembers}
              onChange={(e) => setMaxMembers(Number(e.target.value))}
              className="w-full bg-[#05090B] border border-[rgba(100,220,205,0.18)] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-[#21D4E5] focus:ring-1 focus:ring-[#21D4E5]/30 font-mono transition-all"
            >
              <option value={3}>3 Members (Strict Quorum)</option>
              <option value={5}>5 Members (Team Vault)</option>
              <option value={10}>10 Members (Enterprise Compartment)</option>
              <option value={20}>20 Members (Extended Cell)</option>
              <option value={50}>50 Members (Departmental Vault)</option>
              <option value={100}>100 Members (Organization Wide)</option>
            </select>
            <p className="text-[10px] text-slate-500 mt-1.5 font-mono">Capacity adjustments propagate immediately across connected peers.</p>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[rgba(100,220,205,0.16)] bg-[#0F171B] text-xs font-mono text-slate-300 hover:bg-[#152329] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#10BFA5] to-[#21D4E5] hover:opacity-90 text-xs font-mono font-bold text-slate-950 transition-all shadow-[0_0_15px_rgba(33,212,229,0.3)]"
            >
              {loading ? <span>Saving...</span> : <span>Save Settings</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
