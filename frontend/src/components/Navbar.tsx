import React from 'react';
import { Shield, Lock, Unlock, Wifi, WifiOff, Copy, Check, LogOut, Terminal, Users, Database } from 'lucide-react';
import { ConnectionState } from '../lib/websocket';

interface NavbarProps {
  roomCode: string | null;
  roomName: string | null;
  isLocked: boolean;
  lockReason: string | null;
  connectionState: ConnectionState;
  user: { id: string; username: string; role: string } | null;
  onLeaveRoom: () => void;
  onLogout: () => void;
  onOpenHeist: () => void;
  onToggleLock: () => void;
  activeRightTab: string;
  setActiveRightTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  roomCode,
  roomName,
  isLocked,
  lockReason,
  connectionState,
  user,
  onLeaveRoom,
  onLogout,
  onOpenHeist,
  onToggleLock,
  activeRightTab,
  setActiveRightTab,
}) => {
  const [copied, setCopied] = React.useState(false);

  const copyCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="h-14 border-b border-[#212638] bg-[#0c0e17] px-4 flex items-center justify-between select-none">
      {/* Left: Brand & Room Info */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded border border-cyan-500/30 bg-cyan-950/40 flex items-center justify-center text-cyan-400 font-bold text-sm tracking-wider shadow-[0_0_12px_rgba(6,182,212,0.15)]">
            VR
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-sm font-semibold tracking-wider text-slate-100">VAULTROOM</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1e2436] text-cyan-400 border border-cyan-800/40">
                E2EE v1.0
              </span>
            </div>
          </div>
        </div>

        {roomCode && (
          <div className="hidden sm:flex items-center space-x-3 pl-4 border-l border-[#212638]">
            <span className="text-xs text-slate-400 font-medium">{roomName || 'Active Room'}:</span>
            <button
              onClick={copyCode}
              title="Click to copy 6-character room code"
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[#141724] border border-[#262c42] hover:border-cyan-500/50 hover:bg-[#1a1f33] transition-all group"
            >
              <span className="font-mono text-xs font-bold text-cyan-400 tracking-widest">{roomCode}</span>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-400" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Center: Security Lockdown Banner if active */}
      {isLocked && (
        <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-red-950/60 border border-red-800/60 rounded text-red-300 text-xs animate-pulse">
          <Lock className="w-3.5 h-3.5 text-red-400" />
          <span className="font-mono font-medium">SECURITY LOCKDOWN ACTIVE: {lockReason || 'Write suspended'}</span>
        </div>
      )}

      {/* Right: Real Connection State, Security Actions & User */}
      <div className="flex items-center space-x-3">
        {/* Connection State Indicator (Accurate) */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[#121520] border border-[#212638]">
          <span
            className={`w-2 h-2 rounded-full ${
              connectionState === 'connected'
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                : connectionState === 'connecting' || connectionState === 'reconnecting'
                ? 'bg-amber-400 animate-ping'
                : 'bg-red-400'
            }`}
          />
          <span className="font-mono text-[11px] capitalize text-slate-300">
            {connectionState}
          </span>
        </div>

        {/* Heist Mode Demo Button */}
        {roomCode && (
          <button
            onClick={onOpenHeist}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 hover:border-red-600 text-red-300 text-xs font-mono transition-colors"
          >
            <Shield className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden sm:inline">Heist Mode</span>
          </button>
        )}

        {/* Lock / Unlock Toggle Button */}
        {roomCode && (
          <button
            onClick={onToggleLock}
            title={isLocked ? 'Unlock Room' : 'Engage Emergency Lockdown'}
            className={`p-1.5 rounded border transition-colors ${
              isLocked
                ? 'bg-red-900/30 border-red-700 text-red-400 hover:bg-red-900/50'
                : 'bg-[#141724] border-[#262c42] text-slate-400 hover:text-amber-400 hover:border-amber-500/50'
            }`}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
        )}

        {/* User Pill */}
        {user && (
          <div className="flex items-center space-x-2 pl-2 border-l border-[#212638]">
            <div className="flex flex-col items-end">
              <span className="text-xs font-medium text-slate-200">{user.username}</span>
              <span className="text-[10px] font-mono text-cyan-400 uppercase">{user.role}</span>
            </div>
            <button
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 rounded hover:bg-[#1f2438] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
