import React, { useState } from 'react';
import { AlertTriangle, Trash2, LogOut, X, Lock } from 'lucide-react';

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
    <div className="fixed inset-0 bg-[#08090e]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="bg-[#0f111a] border border-[#212638] rounded-xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-950/40 border border-amber-800/50 flex items-center justify-center text-amber-400">
              <LogOut className="w-5 h-5" />
            </div>
            <h2 className="text-base font-mono font-bold text-slate-100">Sign Out</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-[#1a1f33] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-4">
          Are you sure you want to sign out of your VaultRoom session?
        </p>

        {hasUnsavedChanges && (
          <div className="mb-4 p-3 rounded-lg bg-amber-950/40 border border-amber-700/50 flex items-start space-x-2.5 text-xs text-amber-300 font-mono">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>Warning: You have unsaved changes in your document that will not be saved if you sign out now.</span>
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#262c42] bg-[#141724] text-xs font-mono text-slate-300 hover:bg-[#1c2236] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-mono font-semibold text-slate-950 transition-colors shadow-lg shadow-amber-900/30"
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
    <div className="fixed inset-0 bg-[#08090e]/85 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="bg-[#0f111a] border border-red-900/50 rounded-xl max-w-md w-full p-6 shadow-2xl shadow-red-950/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-red-950/50 border border-red-800/60 flex items-center justify-center text-red-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <h2 className="text-base font-mono font-bold text-red-200">Delete Room Permanently</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-[#1a1f33] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 text-xs text-slate-300 space-y-2">
          <p>
            You are about to permanently delete room <span className="font-mono font-bold text-cyan-400 bg-[#161a29] px-1.5 py-0.5 rounded border border-cyan-800/40">{roomCode}</span>.
          </p>
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-300 text-[11px] font-mono leading-relaxed">
            <span className="font-bold block mb-1">CONSEQUENCES:</span>
            • All saved zero-knowledge encrypted documents will be destroyed.<br />
            • Secrets, sources, approvals, and activity history will be deleted.<br />
            • All connected users will be immediately disconnected.
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded bg-red-950/60 border border-red-700 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#262c42] bg-[#141724] text-xs font-mono text-slate-300 hover:bg-[#1c2236] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-mono font-semibold text-white transition-colors shadow-lg shadow-red-950/50 flex items-center space-x-1.5"
          >
            {loading ? (
              <span>Deleting...</span>
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
    <div className="fixed inset-0 bg-[#08090e]/85 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="bg-[#0f111a] border border-red-900/60 rounded-xl max-w-md w-full p-6 shadow-2xl shadow-red-950/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-red-950/60 border border-red-800/80 flex items-center justify-center text-red-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <h2 className="text-base font-mono font-bold text-red-200">Delete Account Permanently</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-[#1a1f33] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 text-xs text-slate-300 space-y-2">
          <p>
            You are about to permanently delete the account for <span className="font-bold text-white">{username}</span>.
          </p>
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-300 text-[11px] font-mono leading-relaxed">
            <span className="font-bold block mb-1">DATA ERASURE NOTICE:</span>
            • Your user credentials and account profile will be permanently removed.<br />
            • All rooms created by you and their associated documents will be deleted.<br />
            • This action is immediate and cannot be undone.
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded bg-red-950/60 border border-red-700 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1">
              Enter your password to confirm:
            </label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
              <input
                type="password"
                required
                disabled={loading}
                placeholder="Account password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0a0c13] border border-[#212638] rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-red-500/70"
              />
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[#262c42] bg-[#141724] text-xs font-mono text-slate-300 hover:bg-[#1c2236] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-mono font-semibold text-white transition-colors shadow-lg shadow-red-950/50 flex items-center space-x-1.5"
            >
              {loading ? (
                <span>Verifying & Deleting...</span>
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
