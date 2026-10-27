import React, { useState } from 'react';
import { User, Lock, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';

interface AuthModalProps {
  onSuccess: (user: any) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        const res = await api.register({ username: username.trim(), password });
        onSuccess(res.user);
      } else {
        const res = await api.login({ username: username.trim(), password });
        onSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#08090e]/95 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#0f111a] border border-[#212638] rounded-xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded border border-cyan-500/40 bg-cyan-950/40 flex items-center justify-center text-cyan-400 font-bold text-base shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            VR
          </div>
          <div>
            <h1 className="font-mono text-base font-bold text-slate-100 tracking-wider">VAULTROOM</h1>
            <p className="text-xs text-slate-400">Secure Collaborative Editor & Document Workspace</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded bg-red-950/40 border border-red-800/60 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1">Username</label>
            <div className="relative">
              <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                required
                minLength={3}
                maxLength={50}
                placeholder="alice_dev"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#090b12] border border-[#212638] rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-mono text-slate-400 block mb-1">Password</label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
              <input
                type="password"
                required
                minLength={isRegister ? 6 : 1}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#090b12] border border-[#212638] rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 font-mono"
              />
            </div>
            {isRegister && (
              <p className="text-[10px] text-slate-500 mt-1 font-mono">Minimum 6 characters</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs transition-all flex items-center justify-center space-x-1.5 shadow-[0_0_15px_rgba(6,182,212,0.25)]"
          >
            <span>{loading ? 'Authenticating...' : isRegister ? 'Create Account' : 'Sign In'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-[#1b2030] text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-xs text-slate-400 hover:text-cyan-400 font-mono transition-colors"
          >
            {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
          </button>
        </div>
      </div>
    </div>
  );
};
