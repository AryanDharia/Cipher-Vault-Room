import { invoke, isTauri } from '@tauri-apps/api/core';

const tauriApp = isTauri();

export const secureStorage = {
  async get(name: string): Promise<string | null> {
    if (tauriApp) {
      return invoke<string | null>('secure_get_secret', { name });
    }
    const legacyKey = name.startsWith('room-pass-')
      ? `vaultroom_pass_${name.slice('room-pass-'.length)}`
      : `vaultroom_${name}`;
    return sessionStorage.getItem(legacyKey) || localStorage.getItem(legacyKey);
  },

  async set(name: string, value: string): Promise<void> {
    if (tauriApp) {
      await invoke('secure_set_secret', { name, value });
      return;
    }
    const key = name.startsWith('room-pass-')
      ? `vaultroom_pass_${name.slice('room-pass-'.length)}`
      : `vaultroom_${name}`;
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  },

  async delete(name: string): Promise<void> {
    if (tauriApp) {
      await invoke('secure_delete_secret', { name });
      return;
    }
    const key = name.startsWith('room-pass-')
      ? `vaultroom_pass_${name.slice('room-pass-'.length)}`
      : `vaultroom_${name}`;
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  },
};
