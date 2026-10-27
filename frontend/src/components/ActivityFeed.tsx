import React, { useState } from 'react';
import { Terminal, ChevronUp, ChevronDown, Shield, AlertTriangle, Info, Bell, Filter } from 'lucide-react';

interface ActivityEvent {
  id: string;
  timestamp: string;
  username: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical' | 'alert';
  details: any;
  is_simulated: boolean;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  isLocked: boolean;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ events, isLocked }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'real' | 'simulated' | 'alerts'>('all');

  const filteredEvents = events.filter((e) => {
    if (filter === 'real') return !e.is_simulated;
    if (filter === 'simulated') return e.is_simulated;
    if (filter === 'alerts') return ['warning', 'critical', 'alert'].includes(e.severity);
    return true;
  });

  return (
    <div
      className={`border-t border-[#212638] bg-[#0c0e16] flex flex-col transition-all duration-200 select-none ${
        collapsed ? 'h-9' : 'h-48'
      }`}
    >
      {/* Terminal Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#1b2030] bg-[#090b12]">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-xs font-mono font-medium text-slate-300">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>SECURITY AUDIT STREAM</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#181d2e] text-slate-400 border border-[#262c42]">
              {events.length} events
            </span>
          </div>

          {!collapsed && (
            <div className="hidden sm:flex items-center space-x-1 pl-3 border-l border-[#212638]">
              {(['all', 'real', 'simulated', 'alerts'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono capitalize transition-colors ${
                    filter === f
                      ? 'bg-cyan-950/70 border border-cyan-800/60 text-cyan-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-[#181d2e] transition-colors"
          title={collapsed ? 'Expand Feed' : 'Collapse Feed'}
        >
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Terminal Event List */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-1">
          {filteredEvents.length === 0 ? (
            <div className="text-slate-600 italic py-4 text-center">
              No audit stream events recorded in current filter.
            </div>
          ) : (
            filteredEvents.map((e) => {
              const dateStr = new Date(e.timestamp).toLocaleTimeString();
              const isSim = e.is_simulated;
              const severityColor =
                e.severity === 'critical' || e.severity === 'alert'
                  ? 'text-red-400'
                  : e.severity === 'warning'
                  ? 'text-amber-400'
                  : 'text-cyan-400';

              return (
                <div
                  key={e.id}
                  className="flex items-start space-x-2 px-2 py-1 rounded hover:bg-[#121522] transition-colors group"
                >
                  <span className="text-slate-600 shrink-0 select-none">[{dateStr}]</span>

                  {/* Real vs Simulated Tag */}
                  <span
                    className={`px-1 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                      isSim
                        ? 'bg-amber-950/60 border border-amber-800/40 text-amber-300'
                        : 'bg-cyan-950/60 border border-cyan-800/40 text-cyan-300'
                    }`}
                  >
                    {isSim ? 'SIMULATED' : 'REAL'}
                  </span>

                  <span className={`font-semibold shrink-0 ${severityColor}`}>
                    {e.event_type}
                  </span>

                  <span className="text-slate-400 shrink-0">by @{e.username}:</span>

                  <span className="text-slate-300 truncate">
                    {e.details?.title
                      ? `"${e.details.title}"`
                      : e.details?.reason
                      ? e.details.reason
                      : e.details?.name
                      ? e.details.name
                      : JSON.stringify(e.details)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
