import React, { useCallback } from 'react';
import AuthSwitch, { type AuthMode } from './auth-switch';
import { api } from '../lib/api';

interface AuthModalProps {
  onSuccess: (user: any) => void;
  notification?: string | null;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, notification }) => {
  const handleAuthenticate = useCallback(
    async (mode: AuthMode, username: string, password: string) => {
      const response =
        mode === 'signup'
          ? await api.register({ username, password })
          : await api.login({ username, password });
      onSuccess(response.user);
    },
    [onSuccess]
  );

  return (
    <AuthSwitch
      notification={notification}
      onAuthenticate={handleAuthenticate}
    />
  );
};
