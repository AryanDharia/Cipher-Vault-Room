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
  Settings,
  Cpu
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
  width?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
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
  width,
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

  // Merge database members and real-time online users
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
    <aside
      style={width !== undefined ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
      className={`border-l border-[rgba(100,220,205,0.14)] bg-[#05090b]/92 backdrop-blur-xl flex flex-col h-full select-none shrink-0 overflow-hidden ${
        width !== undefined ? '' : 'w-80'
      }`}
    >
      {/* Tab Navigation */}
      <div className="flex border-b border-[rgba(100,220,205,0.14)] bg-[#070d10]/95 p-1.5 gap-1.5">
        <button
          onClick={() => setActiveTab('approvals')}
          className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-all ${
            activeTab === 'approvals'
              ? 'bg-gradient-to-r from-[#21d4e5]/18 to-[#10bfa5]/14 border border-[#21d4e5]/40 text-[#21d4e5] shadow-[0_0_12px_rgba(33,212,229,0.12)]'
              : 'border border-transparent text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115]'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Quorum</span>
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-all ${
            activeTab === 'members'
              ? 'bg-gradient-to-r from-[#21d4e5]/18 to-[#10bfa5]/14 border border-[#21d4e5]/40 text-[#21d4e5] shadow-[0_0_12px_rgba(33,212,229,0.12)]'
              : 'border border-transparent text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Members</span>
        </button>
        <button
          onClick={() => setActiveTab('guard')}
          className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-all ${
            activeTab === 'guard'
              ? 'bg-gradient-to-r from-[#21d4e5]/18 to-[#10bfa5]/14 border border-[#21d4e5]/40 text-[#21d4e5] shadow-[0_0_12px_rgba(33,212,229,0.12)]'
              : 'border border-transparent text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>AI Guard</span>
        </button>
      </div>

      {/* TAB 1: THRESHOLD KEY APPROVALS (Quorum) */}
      {activeTab === 'approvals' && (
        <div className="flex-1 flex flex-col p-3.5 overflow-y-auto space-y-3 pr-2">
          {/* Threshold Quorum Banner */}
          <div className="p-3.5 rounded-xl bg-[rgba(12,22,25,0.7)] border border-[rgba(100,220,205,0.14)] shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono font-bold text-[#f2f7f7]">Threshold Policy</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#21d4e5]/15 border border-[#21d4e5]/35 text-[#21d4e5] font-bold">
                {thresholdRequired}-of-{thresholdTotal} Quorum
              </span>
            </div>
            <p className="text-[11px] text-[#91a4a7] leading-relaxed">
              Unlocking protected documents and encrypted vault records requires consensus from at least{' '}
              <strong className="text-[#f2f7f7]">{thresholdRequired}</strong> authorized key holders.
            </p>
          </div>

          {/* Pending Approval Requests */}
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#91a4a7] font-semibold block mb-2 px-0.5">
              Access Requests ({approvals.length})
            </span>

            {approvals.length === 0 ? (
              <div className="text-center py-10 text-xs text-[#91a4a7] border border-dashed border-[rgba(100,220,205,0.14)] rounded-xl bg-[#070d10]/40">
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
                      className={`p-3 rounded-xl border transition-all ${
                        isApproved
                          ? 'bg-emerald-950/20 border-emerald-800/40'
                          : isRejected
                          ? 'bg-red-950/20 border-red-800/40'
                          : 'bg-[rgba(12,22,25,0.75)] border-[rgba(100,220,205,0.16)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-[#f2f7f7] truncate">
                          {appr.target_resource}
                        </span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md uppercase font-bold ${
                            isApproved
                              ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                              : isRejected
                              ? 'bg-red-900/40 text-red-300 border border-red-700/50'
                              : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                          }`}
                        >
                          {appr.status}
                        </span>
                      </div>

                      {/* Vote Progress Bar */}
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[10px] font-mono text-[#91a4a7] mb-1">
                          <span>Approvals</span>
                          <span className="font-bold text-[#f2f7f7]">
                            {appr.current_count} / {appr.required_count} needed
                          </span>
                        </div>
                        <div className="w-full bg-[#070d10] h-1.5 rounded-full overflow-hidden border border-[rgba(100,220,205,0.12)]">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isApproved ? 'bg-[#10bfa5]' : 'bg-[#21d4e5]'
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
                            className="flex-1 py-1 rounded-lg bg-[#10bfa5] hover:opacity-90 text-[#05090b] font-bold text-xs font-mono transition-all flex items-center justify-center space-x-1 shadow-sm"
                          >
                            <CheckCircle className="w-3 h-3" />
                            <span>Approve</span>
                          </button>
                          <button
                            onClick={() => onVoteApproval(appr.id, 'reject')}
                            className="flex-1 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs font-mono transition-all flex items-center justify-center space-x-1 shadow-sm"
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
        <div className="flex-1 flex flex-col p-3.5 overflow-y-auto space-y-3 pr-2">
          <div className="flex items-center justify-between mb-1 pb-2.5 border-b border-[rgba(100,220,205,0.12)]">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[#91a4a7] font-semibold flex items-center space-x-1.5">
                <span>Room Capacity</span>
                <span className="text-[#21d4e5] font-bold">
                  ({participantList.length} / {maxMembers})
                </span>
              </div>
              <div className="text-[10px] font-mono text-[#10bfa5] mt-0.5 flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10bfa5]" />
                <span>{onlineUsers.length} Online Collaborators</span>
              </div>
            </div>

            {(currentUserRole === 'owner' || currentUserRole === 'co_host') && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-2.5 py-1 rounded-lg bg-[#0b1115] hover:bg-[#121c21] border border-[rgba(100,220,205,0.2)] text-[10px] font-mono text-[#21d4e5] hover:text-white flex items-center space-x-1 transition-all"
                title="Adjust room settings and max capacity"
              >
                <Settings className="w-3 h-3" />
                <span>Capacity</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            {participantList.length === 0 ? (
              <div className="text-center py-8 text-xs text-[#91a4a7] border border-dashed border-[rgba(100,220,205,0.14)] rounded-xl">
                No participants connected.
              </div>
            ) : (
              participantList.map((m) => {
                const online = m.is_online;
                const roleLower = (m.role || 'editor').toLowerCase();
                const isHost = roleLower === 'owner';
                const isCoHost = roleLower === 'co_host' || roleLower === 'cohost';
                const isSelf = m.user_id === currentUserId;

                const isCallerHost = currentUserRole === 'owner';
                const isCallerCoHost = currentUserRole === 'co_host';
                const canKick = !isSelf && !isHost && (isCallerHost || (isCallerCoHost && !isCoHost));

                return (
                  <div
                    key={m.user_id}
                    className="p-2.5 rounded-xl bg-[rgba(12,22,25,0.7)] border border-[rgba(100,220,205,0.14)] hover:border-[#21d4e5]/30 transition-all shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5 truncate">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            online ? 'bg-[#10bfa5] shadow-[0_0_8px_rgba(16,191,165,0.8)]' : 'bg-slate-600'
                          }`}
                          title={online ? 'Online now' : 'Offline'}
                        />
                        <div className="truncate">
                          <div className="text-xs font-semibold text-[#f2f7f7] truncate flex items-center space-x-1.5">
                            <span>{m.username}</span>
                            {isSelf && (
                              <span className="text-[9px] font-mono text-[#91a4a7]">(You)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Role Badge */}
                      <div className="shrink-0 ml-2">
                        {isHost ? (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold bg-[#21d4e5]/15 text-[#21d4e5] border border-[#21d4e5]/35 flex items-center space-x-1">
                            <Crown className="w-3 h-3 text-[#21d4e5]" />
                            <span>HOST</span>
                          </span>
                        ) : isCoHost ? (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold bg-[#10bfa5]/15 text-[#10bfa5] border border-[#10bfa5]/35 flex items-center space-x-1">
                            <Shield className="w-3 h-3 text-[#10bfa5]" />
                            <span>CO-HOST</span>
                          </span>
                        ) : roleLower === 'key_holder' ? (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-mono bg-amber-950/60 text-amber-300 border border-amber-800/50">
                            KEY HOLDER
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-[#070d10] text-[#91a4a7] border border-[rgba(100,220,205,0.12)] uppercase font-semibold">
                            {m.role}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Member Controls */}
                    {(isCallerHost || canKick) && !isSelf && (
                      <div className="mt-2 pt-2 border-t border-[rgba(100,220,205,0.1)] flex items-center justify-between">
                        {isCallerHost && !isHost ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] font-mono text-[#91a4a7]">Role:</span>
                            <select
                              value={isCoHost ? 'co_host' : m.role}
                              onChange={(e) => onUpdateRole(m.user_id, e.target.value)}
                              className="bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded px-2 py-0.5 text-[10px] font-mono text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
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

                        {canKick && (
                          <button
                            type="button"
                            onClick={() => onRequestKickMember?.(m)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-mono text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/60 border border-red-900/60 flex items-center space-x-1 transition-all"
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

      {/* TAB 3: AI SECURITY GUARD */}
      {activeTab === 'guard' && (
        <div className="flex-1 flex flex-col p-3.5 overflow-y-auto space-y-3 pr-2">
          <div className="p-3.5 rounded-xl bg-[rgba(12,22,25,0.7)] border border-[rgba(100,220,205,0.14)] shadow-sm">
            <div className="flex items-center space-x-2 mb-1.5">
              <ShieldAlert className="w-4 h-4 text-[#21d4e5]" />
              <span className="text-xs font-mono font-bold text-[#f2f7f7]">Isolation Forest Guard</span>
            </div>
            <p className="text-[11px] text-[#91a4a7] leading-relaxed">
              Monitors high-frequency metadata anomalies (burst exports, auth failures, privilege abuse) while preserving zero-knowledge document privacy.
            </p>
          </div>

          {/* Threat Meter */}
          <div className="p-3.5 rounded-xl bg-[rgba(12,22,25,0.75)] border border-[rgba(100,220,205,0.16)] shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono font-semibold text-[#f2f7f7]">Live Threat Index</span>
              <span
                className={`text-xs font-mono font-bold ${
                  latestEval?.is_anomaly ? 'text-red-400' : 'text-[#10bfa5]'
                }`}
              >
                {latestEval ? `${(latestEval.threat_score * 100).toFixed(1)}%` : '0.0%'}
              </span>
            </div>

            <div className="w-full bg-[#070d10] h-2 rounded-full overflow-hidden border border-[rgba(100,220,205,0.14)] mb-2.5">
              <div
                className={`h-full transition-all duration-500 ${
                  latestEval?.is_anomaly ? 'bg-red-500' : 'bg-gradient-to-r from-[#10bfa5] to-[#21d4e5]'
                }`}
                style={{ width: `${Math.min(100, (latestEval?.threat_score || 0.05) * 100)}%` }}
              />
            </div>

            <div className="text-[10px] font-mono text-[#91a4a7] space-y-0.5">
              <div>Mode: <span className="text-[#21d4e5] font-semibold">{latestEval?.evaluation_mode || 'Hybrid Guard'}</span></div>
              {latestEval?.dominant_signal && (
                <div>Vector: <span className="text-amber-300 font-semibold">{latestEval.dominant_signal}</span></div>
              )}
            </div>
          </div>

          {/* Anomaly Testing Controls */}
          <div className="p-3.5 rounded-xl bg-[rgba(12,22,25,0.7)] border border-[rgba(100,220,205,0.14)] space-y-2.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#91a4a7] font-semibold block">
              Simulate Threat Signals
            </span>

            <div>
              <div className="flex justify-between text-[10px] font-mono text-[#91a4a7] mb-1">
                <span>Burst Exports/min</span>
                <span className="text-[#21d4e5] font-bold">{testExports}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={testExports}
                onChange={(e) => setTestExports(Number(e.target.value))}
                className="w-full accent-[#21d4e5] h-1.5 bg-[#070d10] rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[10px] font-mono text-[#91a4a7] mb-1">
                <span>Auth Failures/min</span>
                <span className="text-[#21d4e5] font-bold">{testAuthFails}</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={testAuthFails}
                onChange={(e) => setTestAuthFails(Number(e.target.value))}
                className="w-full accent-[#21d4e5] h-1.5 bg-[#070d10] rounded-lg cursor-pointer"
              />
            </div>

            <button
              onClick={() => runAnomalyTest(false)}
              disabled={evaluating}
              className="w-full py-2 rounded-lg bg-[#0b1115] hover:bg-[#121c21] border border-[rgba(100,220,205,0.2)] text-xs font-mono text-[#f2f7f7] hover:text-[#21d4e5] transition-all"
            >
              {evaluating ? 'Analyzing telemetry...' : 'Evaluate Live Metrics'}
            </button>
          </div>

          {/* Heist Mode Launcher */}
          <div className="p-3.5 rounded-xl bg-red-950/25 border border-red-900/50 shadow-sm">
            <span className="text-xs font-mono font-bold text-red-300 block mb-1">Interactive Heist Mode</span>
            <p className="text-[11px] text-[#91a4a7] mb-3 leading-relaxed">
              Trigger a local 30-second security demonstration illustrating automated intrusion detection and lockdown containment.
            </p>
            <button
              onClick={onStartHeist}
              className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-500 text-slate-950 font-bold text-xs font-mono transition-all flex items-center justify-center space-x-1.5 shadow-[0_0_15px_rgba(239,68,68,0.25)]"
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
