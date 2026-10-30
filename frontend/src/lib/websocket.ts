/**
 * VaultRoom WebSocket Client Manager
 * Handles resilient real-time synchronization, presence, and security notifications.
 */
import { isTauri } from '@tauri-apps/api/core';


export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export interface RoomUser {
  user_id: string;
  username: string;
  role: string;
  socket_ids: string[];
}

export interface RemoteCursor {
  user_id: string;
  username: string;
  color: string;
  cursor: { line: number; column: number };
}

export class VaultWebSocket {
  private ws: WebSocket | null = null;
  private roomCode: string;
  private token: string;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private pingInterval: number | null = null;
  private lastActivity = Date.now();
  private watchdogInterval: number | null = null;
  private messageQueue: any[] = [];
  private pendingUpdateAcks = new Map<string, {
    resolve: (persistedAt: string | null) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private stateListeners: Set<(state: ConnectionState) => void> = new Set();
  private isExplicitlyClosed = false;

  constructor(roomCode: string, token: string) {
    this.roomCode = roomCode.trim().toUpperCase();
    this.token = token;
  }

  public getWsUrl(): string {
    // 1. Check if VITE_WS_URL environment variable is provided
    const envWs = import.meta.env?.VITE_WS_URL;
    if (envWs) {
      const base = envWs.endsWith('/') ? envWs.slice(0, -1) : envWs;
      return `${base}/ws/${this.roomCode}?token=${encodeURIComponent(this.token)}`;
    }

    // Tauri's webview host is not the API host. Use the same shared Render
    // service as the browser client for REST and WebSocket traffic.
    if (isTauri()) {
      return `wss://cipher-vault-room.onrender.com/ws/${this.roomCode}?token=${encodeURIComponent(this.token)}`;
    }

    // 2. Dynamic origin detection (Works locally & on Render single-service)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // If running in local Vite development server on port 5173/5174/etc, target backend port 8000
    const host = isLocalDev && window.location.port !== '8000'
      ? `${window.location.hostname}:8000`
      : window.location.host;

    return `${protocol}//${host}/ws/${this.roomCode}?token=${encodeURIComponent(this.token)}`;
  }

  public connect() {
    this.isExplicitlyClosed = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setState('connecting');
    const wsUrl = this.getWsUrl();
    const redactedUrl = wsUrl.replace(/token=([^&]+)/, 'token=[REDACTED]');
    console.log(`[VaultWebSocket] Connecting to: ${redactedUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[VaultWebSocket] Connection established for room: ${this.roomCode}`);
        this.reconnectAttempts = 0;
        this.lastActivity = Date.now();
        this.setState('connected');
        this.startHeartbeat();
        this.flushQueue();
      };

      this.ws.onmessage = (event) => {
        this.lastActivity = Date.now();
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'PONG') {
            console.log(`[VaultWebSocket] Received event: ${msg.type}`);
          }
          if (msg.type === 'ROOM_DELETED' || msg.type === 'KICKED_FROM_ROOM') {
            this.isExplicitlyClosed = true;
            this.stopHeartbeat();
          }
          if (msg.type === 'YJS_UPDATE_ACK' && msg.update_id) {
            const pending = this.pendingUpdateAcks.get(msg.update_id);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingUpdateAcks.delete(msg.update_id);
              pending.resolve(msg.persisted_at ?? null);
            }
          } else if (msg.type === 'ERROR' && msg.update_id) {
            const pending = this.pendingUpdateAcks.get(msg.update_id);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingUpdateAcks.delete(msg.update_id);
              pending.reject(new Error(msg.message || 'The server rejected this document update'));
            }
          }
          this.emit(msg.type, msg);
        } catch {
          // ignore corrupted packets
        }
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        console.warn(`[VaultWebSocket] Closed (code: ${event.code}, reason: "${event.reason || 'None'}", clean: ${event.wasClean})`);
        this.setState('disconnected');

        if (!this.isExplicitlyClosed) {
          const reasonLower = (event.reason || '').toLowerCase();
          // Never attempt to reconnect if room was deleted or terminated
          if (reasonLower.includes('deleted') || reasonLower.includes('terminated')) {
            console.warn('[VaultWebSocket] Room deleted. Reconnect loop aborted.');
            this.isExplicitlyClosed = true;
            return;
          }
          // Don't reconnect if auth policy was explicitly violated or room does not exist
          if (event.code === 1008) {
            console.error(`[VaultWebSocket] Policy violation (${event.reason}). Reconnect aborted.`);
            this.isExplicitlyClosed = true;
            if (reasonLower.includes('expired')) {
              this.emit('AUTH_EXPIRED', { reason: event.reason });
            }
            return;
          }
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[VaultWebSocket] Error event encountered:', err);
      };
    } catch (err) {
      console.error('[VaultWebSocket] Constructor exception:', err);
      this.setState('disconnected');
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts > 25) {
      console.warn('[VaultWebSocket] Maximum reconnect attempts reached.');
      return;
    }
    this.reconnectAttempts++;
    this.setState('reconnecting');
    const delay = Math.min(400 * Math.pow(1.3, this.reconnectAttempts), 8000);
    console.log(`[VaultWebSocket] Attempting reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => {
      if (!this.isExplicitlyClosed) {
        this.connect();
      }
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();

    // 1. Send PING every 15s to keep Render reverse proxy connection alive
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 15000);

    // 2. Watchdog: If no message or PONG in 45s, connection is stale -> force reconnect
    this.watchdogInterval = window.setInterval(() => {
      if (Date.now() - this.lastActivity > 45000) {
        console.warn('[VaultWebSocket] Stale socket detected (no activity in 45s). Forcing reconnect...');
        this.disconnect(false);
        this.connect();
      }
    }, 10000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  public send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (err) {
        console.error('[VaultWebSocket] Send error, enqueuing:', err);
        this.messageQueue.push(data);
      }
    } else {
      // Buffer outgoing messages during temporary reconnects
      this.messageQueue.push(data);
      console.log(`[VaultWebSocket] Buffered message (type: ${data.type}) while disconnected. Queue depth: ${this.messageQueue.length}`);
    }
  }

  private flushQueue() {
    if (this.messageQueue.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    console.log(`[VaultWebSocket] Flushing ${this.messageQueue.length} queued messages to server...`);
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue[0];
      try {
        this.ws.send(JSON.stringify(msg));
        this.messageQueue.shift();
      } catch (err) {
        console.error('[VaultWebSocket] Error while flushing queue:', err);
        break;
      }
    }
  }

  public sendAndWaitForPersistence(data: {
    type: 'YJS_UPDATE';
    document_id: string;
    update_id: string;
    encrypted_payload: string;
  }, timeoutMs = 20000): Promise<string | null> {
    if (this.isExplicitlyClosed) return Promise.reject(new Error('This room connection is closed'));
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is offline; the encrypted update remains on this device'));
    }
    if (this.pendingUpdateAcks.has(data.update_id)) {
      return Promise.reject(new Error('This update is already waiting for server confirmation'));
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingUpdateAcks.delete(data.update_id);
        reject(new Error('The server did not confirm persistence in time; the encrypted update was kept for retry'));
      }, timeoutMs);
      this.pendingUpdateAcks.set(data.update_id, { resolve, reject, timeout });
      try {
        this.ws!.send(JSON.stringify(data));
      } catch {
        clearTimeout(timeout);
        this.pendingUpdateAcks.delete(data.update_id);
        reject(new Error('Could not send the update; the encrypted update remains on this device'));
      }
    });
  }

  public on(type: string, handler: (data: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  public onStateChange(handler: (state: ConnectionState) => void) {
    this.stateListeners.add(handler);
    handler(this.state);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  private emit(type: string, data: any) {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.forEach((h) => h(data));
    }
  }

  private setState(state: ConnectionState) {
    if (this.state !== state) {
      this.state = state;
      console.log(`[VaultWebSocket] State changed to: ${state}`);
      this.stateListeners.forEach((h) => h(state));
    }
  }

  public disconnect(explicit = true) {
    this.isExplicitlyClosed = explicit;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }
}
