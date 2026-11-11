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
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border-2 border-red-500/40 rounded-2xl max-w-2xl w-full p-6 shadow-[0_0_60px_rgba(239,68,68,0.25)] text-slate-100 flex flex-col max-h-[90vh] overflow-hidden backdrop-blur-xl relative">
        {/* Top ambient glow line */}
        <div className="bg-gradient-to-r from-red-500/50 via-rose-500/30 to-transparent h-[1px] absolute top-0 left-0 right-0" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-red-500/25">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.35)]">
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="font-mono text-base font-bold text-red-200 tracking-wider">HEIST MODE SIMULATION</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-950/80 text-red-400 border border-red-800/60 font-semibold tracking-wider">
                  SIMULATED
                </span>
              </div>
              <p className="text-xs text-red-400/80 font-mono">30-Second Defensive Quorum & Isolation Verification</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {isRunning && (
              <div className="flex items-center space-x-2 font-mono text-xs font-bold text-red-400 bg-red-950/40 px-2.5 py-1 rounded-lg border border-red-800/50">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span>{countdown}s remaining</span>
              </div>
            )}
            <button
              onClick={onClose}
              disabled={isRunning}
              className="px-3.5 py-1.5 rounded-xl bg-red-950/30 hover:bg-red-900/50 border border-red-800/60 text-xs font-mono text-slate-300 disabled:opacity-40 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {!isRunning && !finalReport && (
            <div className="p-5 rounded-xl bg-red-950/20 border border-red-500/25 space-y-3.5">
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                This controlled, local simulation demonstrates VaultRoom's active security posture against an automated adversary attempting bulk vault exfiltration and threshold bypass.
              </p>
              <div className="text-[11px] font-mono text-slate-400 space-y-1.5 p-3 rounded-lg bg-[#05090B]/60 border border-[rgba(100,220,205,0.1)]">
                <div className="text-[#10BFA5]">✓ Zero production data or client keys will be modified</div>
                <div className="text-[#10BFA5]">✓ Isolation Forest evaluates synthetic anomaly vectors</div>
                <div className="text-[#10BFA5]">✓ Verifies 2-of-3 threshold envelope defense locks</div>
              </div>

              <div className="pt-2">
                <button
                  onClick={startSimulation}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs font-mono transition-all flex items-center justify-center space-x-2 shadow-[0_0_25px_rgba(239,68,68,0.4)]"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Start 30-Second Simulation</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Live Timeline */}
          {timeline.length > 0 && (
            <div className="space-y-2.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-red-400/80 block font-semibold">
                Simulated Attack Vector Sequence
              </span>

              {timeline.slice(0, currentStep).map((evt, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-[#070D10]/90 border border-red-500/25 flex items-start space-x-3 text-xs animate-fadeIn"
                >
                  <div className="w-6 h-6 rounded-full bg-red-950 border border-red-500/40 flex items-center justify-center text-[11px] font-mono font-bold text-red-400 shrink-0">
                    {evt.step}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-red-300">{evt.event_type}</span>
                      <span className="text-[10px] font-mono text-slate-500">+{evt.elapsed_seconds}s</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1 font-sans">{evt.description}</p>
                    <div className="text-[10px] font-mono text-red-400/80 mt-1">Actor: {evt.actor}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Incident Containment Report */}
          {finalReport && (
            <div className="p-5 rounded-xl bg-[#071F1A]/80 border border-[#10BFA5]/40 space-y-3.5 animate-fadeIn">
              <div className="flex items-center space-x-2 text-[#10BFA5] font-mono text-xs font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>INCIDENT CONTAINMENT & DEFENSE REPORT</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-[11px] font-mono">
                <div className="p-3 rounded-xl bg-[#05090B] border border-[#10BFA5]/25">
                  <span className="text-slate-400 block text-[10px]">Plaintext Exposed:</span>
                  <span className="text-[#10BFA5] font-bold text-xs">0 bytes (Zero-Knowledge)</span>
                </div>
                <div className="p-3 rounded-xl bg-[#05090B] border border-[#10BFA5]/25">
                  <span className="text-slate-400 block text-[10px]">Threshold Envelope:</span>
                  <span className="text-[#10BFA5] font-bold text-xs">Resisted 1-Actor Access</span>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-300 space-y-1.5">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Exercised Defenses:</span>
                {finalReport.exercised_protections.map((p: string, i: number) => (
                  <div key={i} className="flex items-start space-x-2 text-slate-200">
                    <span className="text-[#10BFA5] font-bold">✓</span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  onClick={startSimulation}
                  className="px-4 py-2 rounded-xl bg-[#0E1A18] hover:bg-[#132622] border border-[#10BFA5]/50 text-xs font-mono text-[#10BFA5] flex items-center space-x-1.5 transition-colors"
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
