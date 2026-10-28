/**
 * VaultRoom WebSocket Client Manager
 * Handles resilient real-time synchronization, presence, and security notifications.
 */

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
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private stateListeners: Set<(state: ConnectionState) => void> = new Set();

  constructor(roomCode: string, token: string) {
    this.roomCode = roomCode;
    this.token = token;
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setState('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    // If in local dev and running on a Vite/dev port (e.g. 5173, 5174, etc.), connect directly to backend 8000.
    // In production (Render single-service), connect directly to window.location.host.
    const host = isLocalDev && window.location.port !== '8000'
      ? `${window.location.hostname}:8000`
      : window.location.host;
    const wsUrl = `${protocol}//${host}/ws/${this.roomCode}?token=${encodeURIComponent(this.token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState('connected');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.type, msg);
        } catch {
          // ignore corrupted packets
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.setState('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.stopHeartbeat();
        this.setState('disconnected');
      };
    } catch {
      this.setState('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts > 15) return;
    this.reconnectAttempts++;
    this.setState('reconnecting');
    const delay = Math.min(500 * Math.pow(1.3, this.reconnectAttempts), 5000);
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
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
    this.state = state;
    this.stateListeners.forEach((h) => h(state));
  }

  public disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }
}
