import React, { useState, useRef, useEffect } from 'react';
import { Shield, Lock, Unlock, Copy, Check, LogOut, Trash2, User, ChevronDown } from 'lucide-react';
import { ConnectionState } from '../lib/websocket';

interface NavbarProps {
  roomCode: string | null;
  roomName: string | null;
  isLocked: boolean;
  lockReason: string | null;
  connectionState: ConnectionState;
  user: { id: string; username: string; role: string } | null;
  currentUserRole?: string;
  onLeaveRoom: () => void;
  onLogout: () => void;
  onOpenHeist: () => void;
  onToggleLock: () => void;
  onDeleteRoom?: () => void;
  onOpenDeleteAccount?: () => void;
  activeRightTab?: string;
  setActiveRightTab?: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  roomCode,
  roomName,
  isLocked,
  lockReason,
  connectionState,
  user,
  currentUserRole,
  onLeaveRoom,
  onLogout,
  onOpenHeist,
  onToggleLock,
  onDeleteRoom,
  onOpenDeleteAccount,
}) => {
  const [copied, setCopied] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const copyCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isHost = currentUserRole === 'owner';

  return (
    <header className="h-14 border-b border-[#212638] bg-[#0c0e17] px-4 flex items-center justify-between select-none relative z-30">
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

            {isHost && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-400 border border-cyan-700/50">
                HOST
              </span>
            )}
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
        {/* Connection State Indicator */}
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

        {/* Host-Only Delete Room Option */}
        {roomCode && isHost && onDeleteRoom && (
          <button
            onClick={onDeleteRoom}
            title="Permanently Delete Room (Host Only)"
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 hover:border-red-600 text-red-300 text-xs font-mono transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden sm:inline">Delete Room</span>
          </button>
        )}

        {/* Leave Room (Non-Host or voluntary exit) */}
        {roomCode && (
          <button
            onClick={onLeaveRoom}
            title="Leave current room"
            className="px-2 py-1 rounded bg-[#141724] border border-[#262c42] hover:bg-[#1a1f33] text-slate-300 hover:text-white text-xs font-mono transition-colors hidden sm:inline"
          >
            Leave
          </button>
        )}

        {/* Heist Mode Demo Button */}
        {roomCode && (
          <button
            onClick={onOpenHeist}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 hover:border-red-600 text-red-300 text-xs font-mono transition-colors"
          >
            <Shield className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden md:inline">Heist Mode</span>
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

        {/* User Pill & Account Dropdown */}
        {user && (
          <div className="relative pl-2 border-l border-[#212638]" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center space-x-2 p-1 rounded hover:bg-[#141724] border border-transparent hover:border-[#262c42] transition-colors"
            >
              <div className="w-6 h-6 rounded bg-cyan-950/60 border border-cyan-800/40 flex items-center justify-center text-cyan-400">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col items-start hidden sm:flex text-left">
                <span className="text-xs font-medium text-slate-200 leading-tight">{user.username}</span>
                <span className="text-[10px] font-mono text-cyan-400 uppercase leading-none">{user.role}</span>
              </div>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Account Settings / Actions Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#0f111a] border border-[#212638] shadow-2xl py-1.5 z-50 animate-fadeIn">
                <div className="px-3 py-2 border-b border-[#212638]">
                  <p className="text-xs font-semibold text-slate-100">{user.username}</p>
                  <p className="text-[10px] font-mono text-cyan-400 uppercase tracking-wide">Role: {user.role}</p>
                  <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5">ID: {user.id.slice(0, 8)}...</p>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-mono text-slate-300 hover:bg-[#1a1f33] hover:text-white flex items-center space-x-2 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5 text-amber-400" />
                    <span>Sign Out</span>
                  </button>

                  {onOpenDeleteAccount && (
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        onOpenDeleteAccount();
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-mono text-red-400 hover:bg-red-950/50 hover:text-red-300 flex items-center space-x-2 transition-colors border-t border-[#212638]/50 mt-1"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      <span>Delete Account</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
