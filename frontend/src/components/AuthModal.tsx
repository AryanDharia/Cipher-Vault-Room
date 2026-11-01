import AuthSwitch, { type AuthMode } from './auth-switch';
import { api } from '../lib/api';

interface AuthModalProps {
  onSuccess: (user: any) => void;
  notification?: string | null;
}

export const AuthModal = ({ onSuccess, notification }: AuthModalProps) => (
  <AuthSwitch
    notification={notification}
    onAuthenticate={async (mode: AuthMode, username: string, password: string) => {
      const response = mode === 'signup'
        ? await api.register({ username, password })
        : await api.login({ username, password });
      onSuccess(response.user);
    }}
  />
);
