import React, { useState, useEffect } from 'react';
import { Shield, AlertOctagon, Lock, CheckCircle2, XCircle, RotateCcw, FileText, ChevronRight, Play } from 'lucide-react';
import { api } from '../lib/api';

interface HeistModalProps {
  roomCode: string;
  isOpen: boolean;
  onClose: () => void;
  onLockEngaged?: (locked: boolean, reason?: string) => void;
}

export const HeistModal: React.FC<HeistModalProps> = ({ roomCode, isOpen, onClose, onLockEngaged }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [finalReport, setFinalReport] = useState<any | null>(null);
  const [countdown, setCountdown] = useState(30);

  const startSimulation = async () => {
    setIsRunning(true);
    setCurrentStep(0);
    setFinalReport(null);
    setCountdown(30);

    try {
      const res = await api.startHeist(roomCode);
      setTimeline(res.timeline);

      // Play through simulation timeline over ~30 seconds (or accelerated for smooth demo)
      let step = 0;
      const interval = setInterval(() => {
        step++;
        setCurrentStep(step);

        if (step === 4 && onLockEngaged) {
          onLockEngaged(true, 'Heist simulation automated containment');
        }

        if (step >= res.timeline.length) {
          clearInterval(interval);
          setFinalReport(res.report);
          setIsRunning(false);
        }
      }, 4500); // 6 steps * 4.5s = ~27-30s
    } catch (err: any) {
      alert(`Simulation failed to start: ${err.message}`);
      setIsRunning(false);
    }
  };

  useEffect(() => {
    let timer: number;
    if (isRunning && countdown > 0) {
      timer = window.setInterval(() => {
        setCountdown((c) => Math.max(0, c - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isRunning, countdown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#100808] border-2 border-red-600/70 rounded-xl max-w-2xl w-full p-6 shadow-[0_0_50px_rgba(239,68,68,0.3)] text-slate-100 flex flex-col max-h-[90vh] overflow-hidden select-none">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-red-900/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded bg-red-950/80 border border-red-500/60 flex items-center justify-center shadow-[0_0_15px_rgba(239,68,68,0.4)]">
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="font-mono text-base font-bold text-red-200 tracking-wider">HEIST MODE SIMULATION</h2>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950 text-red-400 border border-red-800">
                  SIMULATED
                </span>
              </div>
              <p className="text-xs text-red-400/80">30-Second Defensive Quorum & Isolation Verification</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {isRunning && (
              <div className="flex items-center space-x-1.5 font-mono text-sm font-bold text-red-400">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                <span>{countdown}s remaining</span>
              </div>
            )}
            <button
              onClick={onClose}
              disabled={isRunning}
              className="px-3 py-1 rounded bg-red-950/40 hover:bg-red-900/60 border border-red-800 text-xs font-mono text-slate-300 disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {!isRunning && !finalReport && (
            <div className="p-4 rounded-lg bg-red-950/20 border border-red-900/40 space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                This controlled, local simulation demonstrates VaultRoom's active security posture against an automated adversary attempting bulk vault exfiltration and threshold bypass.
              </p>
              <div className="text-[11px] font-mono text-slate-400 space-y-1">
                <div>✓ Zero production data or keys will be modified</div>
                <div>✓ Isolation Forest evaluates synthetic anomaly vectors</div>
                <div>✓ Verifies 2-of-3 threshold envelope defense</div>
              </div>

              <div className="pt-2">
                <button
                  onClick={startSimulation}
                  className="w-full py-2.5 rounded bg-red-600 hover:bg-red-500 text-slate-950 font-bold text-xs font-mono transition-all flex items-center justify-center space-x-2 shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>Start 30-Second Simulation</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Live Timeline */}
          {timeline.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-red-400/80 block">
                Simulated Event Sequence
              </span>

              {timeline.slice(0, currentStep).map((evt, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-[#180a0a] border border-red-900/60 flex items-start space-x-3 text-xs animate-fadeIn"
                >
                  <div className="w-5 h-5 rounded-full bg-red-950 border border-red-500/40 flex items-center justify-center text-[10px] font-mono font-bold text-red-400 shrink-0">
                    {evt.step}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-red-300">{evt.event_type}</span>
                      <span className="text-[10px] font-mono text-slate-500">+{evt.elapsed_seconds}s</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">{evt.description}</p>
                    <div className="text-[10px] font-mono text-red-400/70 mt-1">Actor: {evt.actor}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Incident Containment Report */}
          {finalReport && (
            <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/50 space-y-3">
              <div className="flex items-center space-x-2 text-emerald-400 font-mono text-xs font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>INCIDENT CONTAINMENT & DEFENSE REPORT</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded bg-[#0a120e] border border-emerald-900/40">
                  <span className="text-slate-400 block text-[10px]">Plaintext Exposed:</span>
                  <span className="text-emerald-300 font-bold">0 bytes (Zero-Knowledge)</span>
                </div>
                <div className="p-2 rounded bg-[#0a120e] border border-emerald-900/40">
                  <span className="text-slate-400 block text-[10px]">Threshold Envelope:</span>
                  <span className="text-emerald-300 font-bold">Resisted 1-Actor Access</span>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-300 space-y-1">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Exercised Defenses:</span>
                {finalReport.exercised_protections.map((p: string, i: number) => (
                  <div key={i} className="flex items-start space-x-1.5">
                    <span className="text-emerald-400 font-bold">✓</span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  onClick={startSimulation}
                  className="px-3 py-1.5 rounded bg-[#16201a] hover:bg-[#203028] border border-emerald-800/60 text-xs font-mono text-emerald-300 flex items-center space-x-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Re-run Simulation</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
