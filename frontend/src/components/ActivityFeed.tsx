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
      className={`border-t border-[rgba(100,220,205,0.14)] bg-[#05090b]/95 backdrop-blur-md flex flex-col shrink-0 select-none overflow-hidden relative z-20 transition-[height] ${
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
      <div className="h-9 px-4 flex items-center justify-between border-b border-[rgba(100,220,205,0.1)] bg-[#070d10] shrink-0">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex items-center space-x-1.5 text-xs font-mono font-bold text-[#f2f7f7] hover:text-[#21d4e5] transition-colors focus:outline-none"
            title={collapsed ? 'Expand Security Audit Stream' : 'Collapse Security Audit Stream'}
          >
            <Terminal className="w-3.5 h-3.5 text-[#21d4e5]" />
            <span className="tracking-wider">SECURITY AUDIT STREAM</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-[#0b1115] text-[#91a4a7] border border-[rgba(100,220,205,0.14)]">
              {events.length} events
            </span>
          </button>

          {/* Quick Alert Badge if any alerts exist */}
          {alertCount > 0 && (
            <span className="flex items-center space-x-1 text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-amber-950/60 border border-amber-800/50 text-amber-300 animate-pulse font-bold">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>{alertCount} alert{alertCount !== 1 ? 's' : ''}</span>
            </span>
          )}

          {!collapsed && (
            <div className="hidden sm:flex items-center space-x-1 pl-3 border-l border-[rgba(100,220,205,0.12)]">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-all ${
                  filter === 'all'
                    ? 'bg-[#21d4e5]/15 border border-[#21d4e5]/40 text-[#21d4e5] font-bold'
                    : 'text-[#91a4a7] hover:text-[#f2f7f7]'
                }`}
              >
                All ({allCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('real')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-all ${
                  filter === 'real'
                    ? 'bg-[#10bfa5]/15 border border-[#10bfa5]/40 text-[#10bfa5] font-bold'
                    : 'text-[#91a4a7] hover:text-[#f2f7f7]'
                }`}
              >
                Real ({realCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('simulated')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-all ${
                  filter === 'simulated'
                    ? 'bg-amber-950/40 border border-amber-800/50 text-amber-300 font-bold'
                    : 'text-[#91a4a7] hover:text-[#f2f7f7]'
                }`}
              >
                Simulated ({simCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('alerts')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-all ${
                  filter === 'alerts'
                    ? 'bg-red-950/40 border border-red-800/50 text-red-300 font-bold'
                    : 'text-[#91a4a7] hover:text-[#f2f7f7]'
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
            className="flex items-center space-x-1 px-2 py-1 rounded-md text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115] transition-all text-xs font-mono"
            title={collapsed ? 'Expand Security Audit Stream' : 'Collapse Security Audit Stream'}
          >
            <span className="text-[10px] text-[#91a4a7] hidden sm:inline">
              {collapsed ? 'Expand' : 'Collapse'}
            </span>
            {collapsed ? <ChevronUp className="w-3.5 h-3.5 text-[#21d4e5]" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Event List */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-1">
          {filteredEvents.length === 0 ? (
            <div className="text-[#91a4a7]/60 italic py-4 text-center">
              No audit stream events recorded in current filter.
            </div>
          ) : (
            filteredEvents.map((e) => {
              const dateStr = new Date(e.timestamp).toLocaleTimeString();
              const isSim = e.is_simulated;
              const severityColor =
                e.severity === 'critical' || e.severity === 'alert'
                  ? 'text-red-400 font-bold'
                  : e.severity === 'warning'
                  ? 'text-amber-400 font-bold'
                  : 'text-[#21d4e5] font-semibold';

              return (
                <div
                  key={e.id}
                  className="flex items-start space-x-2 px-2.5 py-1 rounded-lg hover:bg-[#0b1115]/80 transition-colors group"
                >
                  <span className="text-[#91a4a7]/60 shrink-0 select-none">[{dateStr}]</span>

                  {/* Real vs Simulated Tag */}
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                      isSim
                        ? 'bg-amber-950/50 border border-amber-800/40 text-amber-300'
                        : 'bg-[#10bfa5]/15 border border-[#10bfa5]/35 text-[#10bfa5]'
                    }`}
                  >
                    {isSim ? 'SIMULATED' : 'REAL'}
                  </span>

                  <span className={`shrink-0 ${severityColor}`}>
                    {e.event_type}
                  </span>

                  <span className="text-[#91a4a7] shrink-0">by @{e.username}:</span>

                  <span className="text-[#f2f7f7] truncate">
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
