import React, { useState } from 'react';
import { Shield, PlusCircle, LogIn, Lock, Users, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { deriveRoomKey } from '../lib/crypto';

interface RoomModalProps {
  isOpen: boolean;
  onRoomJoined: (roomData: any, roomKey: CryptoKey) => void;
}

export const RoomModal: React.FC<RoomModalProps> = ({ isOpen, onRoomJoined }) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [thresholdReq, setThresholdReq] = useState(2);
  const [thresholdTot, setThresholdTot] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        const room = await api.createRoom({
          name: roomName.trim() || 'Confidential Financial Vault',
          threshold_required: thresholdReq,
          threshold_total: thresholdTot,
        });

        // Derive client-side zero-knowledge AES-256-GCM key
        const { key } = await deriveRoomKey(passphrase.trim(), room.code);

        onRoomJoined(
          {
            room,
            current_user_role: 'owner',
            members: [],
            online_users: [],
          },
          key
        );
      } else {
        const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (cleanCode.length !== 6) {
          throw new Error('Room code must be exactly 6 characters');
        }

        const res = await api.joinRoom({ code: cleanCode, role: 'editor' });
        const { key } = await deriveRoomKey(passphrase.trim(), cleanCode);

        onRoomJoined(res, key);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to process room action');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#08090e]/95 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#0f111a] border border-[#212638] rounded-xl max-w-md w-full p-6 shadow-2xl">
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

        <form onSubmit={handleSubmit} className="space-y-3.5">
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

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">Threshold Quorum</label>
                  <select
                    value={thresholdReq}
                    onChange={(e) => setThresholdReq(Number(e.target.value))}
                    className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-2.5 py-2 text-xs text-slate-200 font-mono focus:outline-none"
                  >
                    <option value={2}>2 Approvals Needed</option>
                    <option value={3}>3 Approvals Needed</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">Key Holders</label>
                  <select
                    value={thresholdTot}
                    onChange={(e) => setThresholdTot(Number(e.target.value))}
                    className="w-full bg-[#090b12] border border-[#212638] rounded-lg px-2.5 py-2 text-xs text-slate-200 font-mono focus:outline-none"
                  >
                    <option value={3}>3 Eligible Holders</option>
                    <option value={5}>5 Eligible Holders</option>
                  </select>
                </div>
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
              Zero-Knowledge Passphrase <span className="text-cyan-400 text-[10px]">(Never sent to server)</span>
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
              Derives local AES-256-GCM key via PBKDF2 with 100,000 rounds. Server never sees this key.
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
