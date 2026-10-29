import React, { useState } from 'react';
import {
  Users,
  CheckCircle,
  XCircle,
  Clock,
  ShieldAlert,
  AlertTriangle,
  Play,
  RotateCcw,
  UserCheck,
  Activity,
  Sliders,
  Award,
  Crown,
  Shield,
  UserMinus,
  Settings
} from 'lucide-react';
import { RoomUser } from '../lib/websocket';

interface RightSidebarProps {
  roomCode: string;
  thresholdRequired: number;
  thresholdTotal: number;
  maxMembers?: number;
  members: any[];
  onlineUsers: RoomUser[];
  currentUserRole: string;
  currentUserId?: string;
  approvals: any[];
  onVoteApproval: (approvalId: string, decision: 'approve' | 'reject') => void;
  onUpdateRole: (userId: string, newRole: string) => void;
  onRequestKickMember?: (member: any) => void;
  onOpenSettings?: () => void;
  onStartHeist: () => void;
  onEvaluateAnomaly: (metrics: any) => Promise<any>;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  roomCode,
  thresholdRequired,
  thresholdTotal,
  maxMembers = 20,
  members,
  onlineUsers,
  currentUserRole,
  currentUserId,
  approvals,
  onVoteApproval,
  onUpdateRole,
  onRequestKickMember,
  onOpenSettings,
  onStartHeist,
  onEvaluateAnomaly,
}) => {
  const [activeTab, setActiveTab] = useState<'approvals' | 'members' | 'guard'>('approvals');

  // Threat test evaluation state
  const [evaluating, setEvaluating] = useState(false);
  const [latestEval, setLatestEval] = useState<any | null>(null);
  const [testExports, setTestExports] = useState(0);
  const [testAuthFails, setTestAuthFails] = useState(0);
  const [testReqRate, setTestReqRate] = useState(1.5);

  const runAnomalyTest = async (isDemo = false) => {
    setEvaluating(true);
    try {
      const res = await onEvaluateAnomaly({
        export_rate: testExports,
        auth_failures: testAuthFails,
        request_rate: testReqRate,
        perm_changes: 0,
        sensitive_access: testExports > 5 ? 2 : 0,
        is_simulated_demo: isDemo,
      });
      setLatestEval(res);
    } catch {
      // handled
    } finally {
      setEvaluating(false);
    }
  };

  const isOnline = (userId: string) => onlineUsers.some((u) => u.user_id === userId);

  // Merge database members and real-time online users so that any connected participant is always visible
  const participantMap = new Map<string, { id: string; user_id: string; username: string; role: string; is_online: boolean }>();

  (members || []).forEach((m) => {
    participantMap.set(m.user_id, {
      id: m.id || m.user_id,
      user_id: m.user_id,
      username: m.username,
      role: m.role || 'editor',
      is_online: isOnline(m.user_id),
    });
  });

  (onlineUsers || []).forEach((u) => {
    if (participantMap.has(u.user_id)) {
      const existing = participantMap.get(u.user_id)!;
      existing.is_online = true;
      if (u.role) existing.role = u.role;
      if (u.username) existing.username = u.username;
    } else {
      participantMap.set(u.user_id, {
        id: u.user_id,
        user_id: u.user_id,
        username: u.username || 'Collaborator',
        role: u.role || 'editor',
        is_online: true,
      });
    }
  });

  const participantList = Array.from(participantMap.values());

  return (
    <aside className="w-80 border-l border-[#212638] bg-[#0d0f17] flex flex-col h-[calc(100vh-3.5rem)] select-none">
      {/* Tab Navigation */}
      <div className="flex border-b border-[#212638] bg-[#0c0e15]">
        <button
          onClick={() => setActiveTab('approvals')}
          className={`flex-1 py-2.5 text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-colors border-b-2 ${
            activeTab === 'approvals'
              ? 'border-cyan-400 text-cyan-400 bg-[#141724]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Quorum</span>
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-2.5 text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-colors border-b-2 ${
            activeTab === 'members'
              ? 'border-cyan-400 text-cyan-400 bg-[#141724]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Members</span>
        </button>
        <button
          onClick={() => setActiveTab('guard')}
          className={`flex-1 py-2.5 text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-colors border-b-2 ${
            activeTab === 'guard'
              ? 'border-cyan-400 text-cyan-400 bg-[#141724]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>AI Guard</span>
        </button>
      </div>

      {/* TAB 1: THRESHOLD KEY APPROVALS (2-of-3) */}
      {activeTab === 'approvals' && (
        <div className="flex-1 flex flex-col p-3 overflow-y-auto space-y-3">
          {/* Threshold Quorum Banner */}
          <div className="p-3 rounded bg-[#121522] border border-[#212638]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono font-semibold text-slate-200">Threshold Policy</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 font-bold">
                {thresholdRequired}-of-{thresholdTotal} Quorum
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Unlocking protected documents and encrypted vault records requires consensus from at least{' '}
              <strong className="text-slate-200">{thresholdRequired}</strong> authorized key holders.
            </p>
          </div>

          {/* Pending Approval Requests */}
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block mb-2">
              Access Requests ({approvals.length})
            </span>

            {approvals.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-[#1f2438] rounded">
                No active threshold approval requests.
              </div>
            ) : (
              <div className="space-y-2">
                {approvals.map((appr) => {
                  const isApproved = appr.status === 'approved';
                  const isPending = appr.status === 'pending';
                  const isRejected = appr.status === 'rejected';

                  return (
                    <div
                      key={appr.id}
                      className={`p-3 rounded border transition-all ${
                        isApproved
                          ? 'bg-emerald-950/20 border-emerald-800/40'
                          : isRejected
                          ? 'bg-red-950/20 border-red-800/40'
                          : 'bg-[#141724] border-[#262c42]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-slate-200 truncate">
                          {appr.target_resource}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-bold ${
                            isApproved
                              ? 'bg-emerald-900/40 text-emerald-300'
                              : isRejected
                              ? 'bg-red-900/40 text-red-300'
                              : 'bg-amber-900/40 text-amber-300'
                          }`}
                        >
                          {appr.status}
                        </span>
                      </div>

                      {/* Vote Progress Bar */}
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                          <span>Approvals</span>
                          <span className="font-bold text-slate-200">
                            {appr.current_count} / {appr.required_count} needed
                          </span>
                        </div>
                        <div className="w-full bg-[#0a0c13] h-1.5 rounded-full overflow-hidden border border-[#1f2438]">
                          <div
                            className={`h-full transition-all ${
                              isApproved ? 'bg-emerald-400' : 'bg-cyan-400'
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (appr.current_count / appr.required_count) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Action buttons for key holders/owners */}
                      {isPending && ['owner', 'key_holder'].includes(currentUserRole) && (
                        <div className="mt-3 flex space-x-2">
                          <button
                            onClick={() => onVoteApproval(appr.id, 'approve')}
                            className="flex-1 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-slate-900 font-semibold text-xs font-mono transition-colors flex items-center justify-center space-x-1"
                          >
                            <CheckCircle className="w-3 h-3" />
                            <span>Approve</span>
                          </button>
                          <button
                            onClick={() => onVoteApproval(appr.id, 'reject')}
                            className="flex-1 py-1 rounded bg-red-600/80 hover:bg-red-500 text-slate-900 font-semibold text-xs font-mono transition-colors flex items-center justify-center space-x-1"
                          >
                            <XCircle className="w-3 h-3" />
                            <span>Reject</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ROOM MEMBERS & PERMISSIONS */}
      {activeTab === 'members' && (
        <div className="flex-1 flex flex-col p-3 overflow-y-auto space-y-3">
          <div className="flex items-center justify-between mb-1 pb-2 border-b border-[#1b2033]">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center space-x-1.5">
                <span>Room Capacity</span>
                <span className="text-cyan-400 font-bold">
                  ({participantList.length} / {maxMembers})
                </span>
              </div>
              <div className="text-[10px] font-mono text-emerald-400 mt-0.5">
                {onlineUsers.length} Online Collaborators
              </div>
            </div>

            {(currentUserRole === 'owner' || currentUserRole === 'co_host') && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-2 py-1 rounded bg-[#161a29] hover:bg-[#1f243b] border border-[#262c42] text-[10px] font-mono text-cyan-400 hover:text-white flex items-center space-x-1 transition-colors"
                title="Adjust room settings and max capacity"
              >
                <Settings className="w-3 h-3" />
                <span>Edit Capacity</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            {participantList.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-[#1f2438] rounded">
                No participants connected.
              </div>
            ) : (
              participantList.map((m) => {
                const online = m.is_online;
                const roleLower = (m.role || 'editor').toLowerCase();
                const isHost = roleLower === 'owner';
                const isCoHost = roleLower === 'co_host' || roleLower === 'cohost';
                const isSelf = m.user_id === currentUserId;

                // Host can kick anyone except themselves.
                // Co-host can kick ordinary members (not host, not other co-hosts, not self).
                const isCallerHost = currentUserRole === 'owner';
                const isCallerCoHost = currentUserRole === 'co_host';
                const canKick = !isSelf && !isHost && (isCallerHost || (isCallerCoHost && !isCoHost));

                return (
                  <div
                    key={m.user_id}
                    className="p-2.5 rounded-lg bg-[#121522] border border-[#1f2438] hover:border-[#2a324d] transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5 truncate">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-600'
                          }`}
                          title={online ? 'Online now' : 'Offline'}
                        />
                        <div className="truncate">
                          <div className="text-xs font-medium text-slate-100 truncate flex items-center space-x-1.5">
                            <span>{m.username}</span>
                            {isSelf && (
                              <span className="text-[9px] font-mono text-slate-500">(You)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Role Badge */}
                      <div className="shrink-0 ml-2">
                        {isHost ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950/70 text-purple-300 border border-purple-800/60 flex items-center space-x-1">
                            <Crown className="w-3 h-3 text-purple-400" />
                            <span>HOST</span>
                          </span>
                        ) : isCoHost ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-950/70 text-blue-300 border border-blue-800/60 flex items-center space-x-1">
                            <Shield className="w-3 h-3 text-blue-400" />
                            <span>CO-HOST</span>
                          </span>
                        ) : roleLower === 'key_holder' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 text-amber-300 border border-amber-800/50">
                            KEY HOLDER
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#181d2e] text-slate-400 border border-[#212638] uppercase">
                            {m.role}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Member Controls (Host / Co-host role changes & kick actions) */}
                    {(isCallerHost || canKick) && !isSelf && (
                      <div className="mt-2 pt-2 border-t border-[#1b2033] flex items-center justify-between">
                        {/* Only Original Host can update roles */}
                        {isCallerHost && !isHost ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] font-mono text-slate-500">Role:</span>
                            <select
                              value={isCoHost ? 'co_host' : m.role}
                              onChange={(e) => onUpdateRole(m.user_id, e.target.value)}
                              className="bg-[#0a0c13] border border-[#212638] rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-300 focus:outline-none focus:border-cyan-500/50"
                            >
                              <option value="co_host">Promote to Co-Host</option>
                              <option value="key_holder">Key Holder</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </div>
                        ) : (
                          <div />
                        )}

                        {/* Kick Member button with confirmation */}
                        {canKick && (
                          <button
                            type="button"
                            onClick={() => onRequestKickMember?.(m)}
                            className="px-2 py-0.5 rounded text-[10px] font-mono text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-950/60 border border-red-900/50 flex items-center space-x-1 transition-colors"
                            title={`Remove ${m.username} from room`}
                          >
                            <UserMinus className="w-3 h-3" />
                            <span>Kick</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: AI SECURITY GUARD (Isolation Forest) */}
      {activeTab === 'guard' && (
        <div className="flex-1 flex flex-col p-3 overflow-y-auto space-y-3">
          <div className="p-3 rounded bg-[#121522] border border-[#212638]">
            <div className="flex items-center space-x-2 mb-1.5">
              <ShieldAlert className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-mono font-semibold text-slate-200">Isolation Forest Guard</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Monitors high-frequency metadata anomalies (burst exports, auth failures, privilege abuse) while preserving zero-knowledge document privacy.
            </p>
          </div>

          {/* Threat Meter */}
          <div className="p-3 rounded bg-[#141724] border border-[#262c42]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono text-slate-300">Live Threat Index</span>
              <span
                className={`text-xs font-mono font-bold ${
                  latestEval?.is_anomaly ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {latestEval ? `${(latestEval.threat_score * 100).toFixed(1)}%` : '0.0%'}
              </span>
            </div>

            <div className="w-full bg-[#0a0c13] h-2 rounded-full overflow-hidden border border-[#212638] mb-2">
              <div
                className={`h-full transition-all duration-500 ${
                  latestEval?.is_anomaly ? 'bg-red-500' : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.min(100, (latestEval?.threat_score || 0.05) * 100)}%` }}
              />
            </div>

            <div className="text-[10px] font-mono text-slate-400 space-y-0.5">
              <div>Mode: <span className="text-cyan-400 font-semibold">{latestEval?.evaluation_mode || 'Hybrid Model'}</span></div>
              {latestEval?.dominant_signal && (
                <div>Vector: <span className="text-amber-300 font-semibold">{latestEval.dominant_signal}</span></div>
              )}
            </div>
          </div>

          {/* Anomaly Testing Controls */}
          <div className="p-3 rounded bg-[#121522] border border-[#212638] space-y-2.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
              Simulate Threat Signals
            </span>

            <div>
              <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                <span>Burst Exports/min</span>
                <span>{testExports}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={testExports}
                onChange={(e) => setTestExports(Number(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-[#0a0c13] rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                <span>Auth Failures/min</span>
                <span>{testAuthFails}</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={testAuthFails}
                onChange={(e) => setTestAuthFails(Number(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-[#0a0c13] rounded-lg cursor-pointer"
              />
            </div>

            <button
              onClick={() => runAnomalyTest(false)}
              disabled={evaluating}
              className="w-full py-1.5 rounded bg-[#1c2236] hover:bg-[#252d47] border border-[#2a3350] text-xs font-mono text-slate-200 transition-colors"
            >
              {evaluating ? 'Analyzing...' : 'Evaluate Live Metrics'}
            </button>
          </div>

          {/* Heist Mode Launcher */}
          <div className="p-3 rounded bg-red-950/20 border border-red-900/40">
            <span className="text-xs font-mono font-bold text-red-300 block mb-1">Interactive Heist Mode</span>
            <p className="text-[11px] text-slate-400 mb-3">
              Trigger a local 30-second security demonstration illustrating automated intrusion detection and lockdown containment.
            </p>
            <button
              onClick={onStartHeist}
              className="w-full py-2 rounded bg-red-600 hover:bg-red-500 text-slate-950 font-bold text-xs font-mono transition-colors flex items-center justify-center space-x-1.5 shadow-[0_0_15px_rgba(239,68,68,0.25)]"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Launch 30s Heist Demo</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
