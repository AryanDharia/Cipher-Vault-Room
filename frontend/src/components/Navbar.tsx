import React, { useState, useRef, useEffect } from 'react';
import {
  Shield,
  Lock,
  Unlock,
  Copy,
  Check,
  LogOut,
  Trash2,
  User,
  ChevronDown,
  PanelLeft,
  PanelRight,
  Radio,
  Cpu
} from 'lucide-react';
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
  isLeftCollapsed?: boolean;
  onToggleLeftSidebar?: () => void;
  isRightCollapsed?: boolean;
  onToggleRightSidebar?: () => void;
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
  isLeftCollapsed = false,
  onToggleLeftSidebar,
  isRightCollapsed = false,
  onToggleRightSidebar,
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
    <header className="h-14 border-b border-[rgba(100,220,205,0.14)] bg-[#05090b]/90 backdrop-blur-md px-4 flex items-center justify-between select-none relative z-30 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
      {/* Left: Brand & Room Info */}
      <div className="flex items-center space-x-3.5">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg border border-[#21d4e5]/40 bg-gradient-to-br from-[#21d4e5]/20 to-[#10bfa5]/10 flex items-center justify-center text-[#21d4e5] font-bold text-xs tracking-wider shadow-[0_0_14px_rgba(33,212,229,0.2)]">
            VR
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs font-bold tracking-widest text-[#f2f7f7]">VAULTROOM</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#10bfa5]/15 text-[#10bfa5] border border-[#10bfa5]/30">
                E2EE v1.0
              </span>
            </div>
          </div>
        </div>

        {/* Left Sidebar Toggle */}
        {roomCode && onToggleLeftSidebar && (
          <button
            type="button"
            onClick={onToggleLeftSidebar}
            title={isLeftCollapsed ? 'Expand Files & Sources Sidebar (Ctrl+B)' : 'Collapse Files Sidebar (Ctrl+B)'}
            className={`p-1.5 rounded-lg border transition-all ${
              !isLeftCollapsed
                ? 'bg-[#10bfa5]/15 border-[#10bfa5]/40 text-[#21d4e5] shadow-[0_0_10px_rgba(33,212,229,0.15)]'
                : 'bg-[#0b1115] border-[rgba(100,220,205,0.14)] text-[#91a4a7] hover:text-[#f2f7f7] hover:border-[#21d4e5]/40'
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {roomCode && (
          <div className="hidden sm:flex items-center space-x-3 pl-3.5 border-l border-[rgba(100,220,205,0.14)]">
            <span className="text-xs text-[#91a4a7] font-medium max-w-[140px] truncate" title={roomName || 'Active Room'}>
              {roomName || 'Active Room'}:
            </span>
            <button
              onClick={copyCode}
              title="Click to copy 6-character room code"
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[rgba(12,22,25,0.8)] border border-[rgba(100,220,205,0.2)] hover:border-[#21d4e5]/60 hover:bg-[#0b1115] transition-all group shadow-sm"
            >
              <span className="font-mono text-xs font-bold text-[#21d4e5] tracking-widest">{roomCode}</span>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[#10bfa5]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#91a4a7] group-hover:text-[#21d4e5]" />
              )}
            </button>

            {isHost && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#21d4e5]/15 text-[#21d4e5] border border-[#21d4e5]/35 font-bold tracking-wide">
                HOST
              </span>
            )}
          </div>
        )}
      </div>

      {/* Center: Security Lockdown Banner if active */}
      {isLocked && (
        <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-red-950/70 border border-red-500/50 rounded-lg text-red-200 text-xs animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.25)]">
          <Lock className="w-3.5 h-3.5 text-red-400" />
          <span className="font-mono font-semibold">SECURITY LOCKDOWN ACTIVE: {lockReason || 'Write suspended'}</span>
        </div>
      )}

      {/* Right: Real Connection State, Security Actions & User */}
      <div className="flex items-center space-x-2.5">
        {/* Connection State Indicator */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[#0b1115] border border-[rgba(100,220,205,0.16)]">
          <span
            className={`w-2 h-2 rounded-full ${
              connectionState === 'connected'
                ? 'bg-[#10bfa5] shadow-[0_0_8px_rgba(16,191,165,0.8)]'
                : connectionState === 'connecting' || connectionState === 'reconnecting'
                ? 'bg-amber-400 animate-ping'
                : 'bg-red-400'
            }`}
          />
          <span className="font-mono text-[11px] capitalize text-[#91a4a7]">
            {connectionState}
          </span>
        </div>

        {/* Host-Only Delete Room Option */}
        {roomCode && isHost && onDeleteRoom && (
          <button
            onClick={onDeleteRoom}
            title="Permanently Delete Room (Host Only)"
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 hover:border-red-500 text-red-300 text-xs font-mono transition-all shadow-sm"
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
            className="px-2.5 py-1 rounded-lg bg-[#0b1115] border border-[rgba(100,220,205,0.16)] hover:bg-[#121c21] hover:border-[#21d4e5]/40 text-[#91a4a7] hover:text-[#f2f7f7] text-xs font-mono transition-all hidden sm:inline"
          >
            Leave
          </button>
        )}

        {/* Heist Mode Demo Button */}
        {roomCode && (
          <button
            onClick={onOpenHeist}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 hover:border-red-500 text-red-300 text-xs font-mono transition-all shadow-[0_0_10px_rgba(239,68,68,0.15)]"
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
            className={`p-1.5 rounded-lg border transition-all ${
              isLocked
                ? 'bg-red-900/40 border-red-600 text-red-300 hover:bg-red-900/60 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                : 'bg-[#0b1115] border-[rgba(100,220,205,0.14)] text-[#91a4a7] hover:text-amber-400 hover:border-amber-500/50'
            }`}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
        )}

        {/* Right Sidebar (Quorum / Guard) Toggle */}
        {roomCode && onToggleRightSidebar && (
          <button
            type="button"
            onClick={onToggleRightSidebar}
            title={isRightCollapsed ? 'Expand Quorum & AI Guard Sidebar' : 'Collapse Quorum Sidebar'}
            className={`p-1.5 rounded-lg border transition-all ${
              !isRightCollapsed
                ? 'bg-[#10bfa5]/15 border-[#10bfa5]/40 text-[#21d4e5] shadow-[0_0_10px_rgba(33,212,229,0.15)]'
                : 'bg-[#0b1115] border-[rgba(100,220,205,0.14)] text-[#91a4a7] hover:text-[#f2f7f7] hover:border-[#21d4e5]/40'
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}

        {/* User Pill & Account Dropdown */}
        {user && (
          <div className="relative pl-2 border-l border-[rgba(100,220,205,0.14)]" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center space-x-2 p-1.5 rounded-lg hover:bg-[#0b1115] border border-transparent hover:border-[rgba(100,220,205,0.2)] transition-all"
            >
              <div className="w-6 h-6 rounded-md bg-[#21d4e5]/15 border border-[#21d4e5]/30 flex items-center justify-center text-[#21d4e5]">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col items-start hidden sm:flex text-left">
                <span className="text-xs font-semibold text-[#f2f7f7] leading-tight">{user.username}</span>
                <span className="text-[9px] font-mono text-[#10bfa5] uppercase leading-none">{user.role}</span>
              </div>
              <ChevronDown className="w-3 h-3 text-[#91a4a7]" />
            </button>

            {/* Account Settings / Actions Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#0b1115]/95 border border-[rgba(100,220,205,0.2)] shadow-2xl py-1.5 z-50 backdrop-blur-xl animate-fadeIn">
                <div className="px-3.5 py-2.5 border-b border-[rgba(100,220,205,0.12)]">
                  <p className="text-xs font-bold text-[#f2f7f7]">{user.username}</p>
                  <p className="text-[10px] font-mono text-[#21d4e5] uppercase tracking-wide">Role: {user.role}</p>
                  <p className="text-[10px] font-mono text-[#91a4a7] truncate mt-0.5">ID: {user.id.slice(0, 8)}...</p>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs font-mono text-[#f2f7f7] hover:bg-[#121c21] hover:text-[#21d4e5] flex items-center space-x-2 transition-colors"
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
                      className="w-full text-left px-3.5 py-2 text-xs font-mono text-red-400 hover:bg-red-950/40 hover:text-red-300 flex items-center space-x-2 transition-colors border-t border-[rgba(100,220,205,0.1)] mt-1"
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
