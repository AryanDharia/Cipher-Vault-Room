/**
 * VaultRoom API Client
 */

// In single-service Render architecture and production, all API calls are relative to the current origin
const API_BASE = '/api';

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('vaultroom_token') || sessionStorage.getItem('vaultroom_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('vaultroom_token', token);
      sessionStorage.setItem('vaultroom_token', token);
    } else {
      localStorage.removeItem('vaultroom_token');
      sessionStorage.removeItem('vaultroom_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('vaultroom_token') || sessionStorage.getItem('vaultroom_token');
    }
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });
    } catch (err: any) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new Error('VaultRoom backend server is unreachable. Please ensure the backend is running.');
      }
      throw new Error(`Connection failed: ${err.message || 'Unable to communicate with server'}`);
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.detail || errorData.message || errorMsg;
      } catch {
        // fallback
      }
      const error: any = new Error(errorMsg);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  // Auth
  async register(data: { username: string; password: string }) {
    const res = await this.request<{ access_token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.setToken(res.access_token);
    return res;
  }

  async login(data: { username: string; password: string }) {
    const res = await this.request<{ access_token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.setToken(res.access_token);
    return res;
  }

  async getMe() {
    return this.request<any>('/auth/me');
  }

  // Rooms
  async createRoom(data: { name: string; threshold_required: number; threshold_total: number }) {
    return this.request<any>('/rooms', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async joinRoom(data: { code: string; role?: string }) {
    return this.request<any>('/rooms/join', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getRoom(code: string) {
    return this.request<any>(`/rooms/${code}`);
  }

  async toggleLock(code: string, lock: boolean, reason?: string) {
    return this.request<any>(`/rooms/${code}/lock`, {
      method: 'POST',
      body: JSON.stringify({ lock, reason }),
    });
  }

  async updateRole(code: string, userId: string, role: string) {
    return this.request<any>(`/rooms/${code}/members/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  // Documents
  async listDocuments(code: string) {
    return this.request<any[]>(`/rooms/${code}/documents`);
  }

  async createDocument(code: string, data: { title: string; doc_type: string; language?: string; is_protected?: boolean; encrypted_envelope?: string }) {
    return this.request<any>(`/rooms/${code}/documents`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDocument(code: string, docId: string) {
    return this.request<any>(`/rooms/${code}/documents/${docId}`);
  }

  async updateDocument(code: string, docId: string, data: { title?: string; language?: string; encrypted_envelope?: string; is_protected?: boolean }) {
    return this.request<any>(`/rooms/${code}/documents/${docId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDocument(code: string, docId: string) {
    return this.request<any>(`/rooms/${code}/documents/${docId}`, {
      method: 'DELETE',
    });
  }

  async exportDocument(code: string, docId: string, format = 'markdown') {
    return this.request<any>(`/rooms/${code}/documents/${docId}/export`, {
      method: 'POST',
      body: JSON.stringify({ format }),
    });
  }

  // Approvals
  async listApprovals(code: string) {
    return this.request<any[]>(`/rooms/${code}/approvals`);
  }

  async createApproval(code: string, data: { target_resource: string; document_id?: string; description?: string }) {
    return this.request<any>(`/rooms/${code}/approvals`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async voteApproval(code: string, approvalId: string, decision: 'approve' | 'reject', reason?: string) {
    return this.request<any>(`/rooms/${code}/approvals/${approvalId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
  }

  // Vault Secrets
  async listSecrets(code: string) {
    return this.request<any[]>(`/rooms/${code}/vault`);
  }

  async addSecret(code: string, data: { name: string; category: string; encrypted_value: string; iv: string; description?: string }) {
    return this.request<any>(`/rooms/${code}/vault`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async revealSecret(code: string, secretId: string) {
    return this.request<any>(`/rooms/${code}/vault/${secretId}/reveal`);
  }

  async deleteSecret(code: string, secretId: string) {
    return this.request<any>(`/rooms/${code}/vault/${secretId}`, {
      method: 'DELETE',
    });
  }

  // Sources (NotebookLM)
  async listSources(code: string) {
    return this.request<any[]>(`/rooms/${code}/sources`);
  }

  async addTextSource(code: string, data: { title: string; content: string; source_type: string; tags?: string[] }) {
    return this.request<any>(`/rooms/${code}/sources/text`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async addUrlSource(code: string, data: { title: string; url: string; tags?: string[] }) {
    return this.request<any>(`/rooms/${code}/sources/url`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async uploadFileSource(code: string, file: File, title?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    return this.request<any>(`/rooms/${code}/sources/upload`, {
      method: 'POST',
      body: formData,
    });
  }

  async deleteSource(code: string, sourceId: string) {
    return this.request<any>(`/rooms/${code}/sources/${sourceId}`, {
      method: 'DELETE',
    });
  }

  // Security & Audit
  async getAuditTrail(code: string, limit = 50) {
    return this.request<any[]>(`/rooms/${code}/audit?limit=${limit}`);
  }

  async evaluateAnomaly(code: string, metrics: any) {
    return this.request<any>(`/rooms/${code}/security/evaluate`, {
      method: 'POST',
      body: JSON.stringify(metrics),
    });
  }

  async startHeist(code: string) {
    return this.request<any>(`/rooms/${code}/heist/start`, {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
