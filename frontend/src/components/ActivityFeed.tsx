import React, { useState, useRef } from 'react';
import { Terminal, ChevronUp, ChevronDown, Shield, AlertTriangle, Filter } from 'lucide-react';
import { ResizeDivider } from './ResizeDivider';

export interface ActivityEvent {
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

const DEFAULT_FEED_HEIGHT = 192;
const MIN_FEED_HEIGHT = 100;
const MAX_FEED_HEIGHT = 440;

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ events, isLocked }) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('vaultroom_audit_feed_collapsed') === 'true';
  });

  const [feedHeight, setFeedHeight] = useState<number>(() => {
    const saved = localStorage.getItem('vaultroom_audit_feed_height');
    const val = saved ? Number(saved) : DEFAULT_FEED_HEIGHT;
    return val >= MIN_FEED_HEIGHT && val <= MAX_FEED_HEIGHT ? val : DEFAULT_FEED_HEIGHT;
  });

  const [filter, setFilter] = useState<'all' | 'real' | 'simulated' | 'alerts'>('all');
  const baseHeightRef = useRef(feedHeight);

  const handleStartResize = () => {
    baseHeightRef.current = feedHeight;
  };

  const handleResize = (delta: number) => {
    // Dragging pointer up (negative clientY delta) increases height
    const next = Math.min(MAX_FEED_HEIGHT, Math.max(MIN_FEED_HEIGHT, baseHeightRef.current - delta));
    setFeedHeight(next);
  };

  const handleEndResize = () => {
    localStorage.setItem('vaultroom_audit_feed_height', String(feedHeight));
  };

  const handleResetHeight = () => {
    setFeedHeight(DEFAULT_FEED_HEIGHT);
    localStorage.setItem('vaultroom_audit_feed_height', String(DEFAULT_FEED_HEIGHT));
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('vaultroom_audit_feed_collapsed', String(next));
      return next;
    });
  };

  const filteredEvents = events.filter((e) => {
    if (filter === 'real') return !e.is_simulated;
    if (filter === 'simulated') return e.is_simulated;
    if (filter === 'alerts') return ['warning', 'critical', 'alert'].includes(e.severity);
    return true;
  });

  const allCount = events.length;
  const realCount = events.filter((e) => !e.is_simulated).length;
  const simCount = events.filter((e) => e.is_simulated).length;
  const alertCount = events.filter((e) => ['warning', 'critical', 'alert'].includes(e.severity)).length;

  return (
    <div
      style={{ height: collapsed ? '36px' : `${feedHeight}px` }}
      className={`border-t border-[#212638] bg-[#0c0e16] flex flex-col shrink-0 select-none overflow-hidden relative z-20 transition-[height] ${
        collapsed ? 'duration-200 ease-out' : 'duration-0'
      }`}
    >
      {/* Horizontal Resizer Divider when expanded */}
      {!collapsed && (
        <ResizeDivider
          direction="horizontal"
          ariaLabel="Audit stream height resizer"
          title="Drag up/down to adjust panel height · Double-click to reset"
          onResizeStart={handleStartResize}
          onResize={handleResize}
          onResizeEnd={handleEndResize}
          onReset={handleResetHeight}
        />
      )}

      {/* Terminal Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#1b2030] bg-[#090b12] shrink-0">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex items-center space-x-1.5 text-xs font-mono font-medium text-slate-300 hover:text-cyan-400 transition-colors focus:outline-none"
            title={collapsed ? 'Expand Security Audit Stream' : 'Collapse Security Audit Stream'}
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span className="tracking-wide">SECURITY AUDIT STREAM</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#181d2e] text-slate-400 border border-[#262c42]">
              {events.length} events
            </span>
          </button>

          {/* Quick Alert Badge if any alerts exist */}
          {alertCount > 0 && (
            <span className="flex items-center space-x-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-950/60 border border-amber-800/50 text-amber-300 animate-pulse">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>{alertCount} alert{alertCount !== 1 ? 's' : ''}</span>
            </span>
          )}

          {!collapsed && (
            <div className="hidden sm:flex items-center space-x-1 pl-3 border-l border-[#212638]">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  filter === 'all'
                    ? 'bg-cyan-950/70 border border-cyan-800/60 text-cyan-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                All ({allCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('real')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  filter === 'real'
                    ? 'bg-cyan-950/70 border border-cyan-800/60 text-cyan-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Real ({realCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('simulated')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  filter === 'simulated'
                    ? 'bg-cyan-950/70 border border-cyan-800/60 text-cyan-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Simulated ({simCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('alerts')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  filter === 'alerts'
                    ? 'bg-cyan-950/70 border border-cyan-800/60 text-cyan-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Alerts ({alertCount})
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Collapse/Expand Toggle Button */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex items-center space-x-1 px-1.5 py-1 rounded text-slate-400 hover:text-slate-200 hover:bg-[#181d2e] transition-colors text-xs font-mono"
            title={collapsed ? 'Expand Security Audit Stream' : 'Collapse Security Audit Stream'}
          >
            <span className="text-[10px] text-slate-500 hidden sm:inline">
              {collapsed ? 'Expand' : 'Collapse'}
            </span>
            {collapsed ? <ChevronUp className="w-3.5 h-3.5 text-cyan-400" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
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
