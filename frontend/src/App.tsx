import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { RightSidebar } from './components/RightSidebar';
import { EditorView } from './components/EditorView';
import { ActivityFeed } from './components/ActivityFeed';
import { HeistModal } from './components/HeistModal';
import { AuthModal } from './components/AuthModal';
import { RoomModal } from './components/RoomModal';
import { SignOutModal, DeleteRoomModal, DeleteAccountModal, KickMemberModal, RoomSettingsModal } from './components/ConfirmModal';
import { DocumentPreviewModal } from './components/DocumentPreviewModal';
import { ResizeDivider } from './components/ResizeDivider';
import { api } from './lib/api';
import { VaultWebSocket, ConnectionState, RoomUser } from './lib/websocket';
import { encryptEnvelope, decryptEnvelope, deriveRoomKey } from './lib/crypto';
import { secureStorage } from './lib/secureStorage';
import { upsertSource, dedupeSources, removeSourceById } from './lib/sourceList';

export function App() {
  // Authentication & User State
  const [user, setUser] = useState<any | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Room State
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [maxMembers, setMaxMembers] = useState(20);
  const [thresholdRequired, setThresholdRequired] = useState(2);
  const [thresholdTotal, setThresholdTotal] = useState(3);
  const [currentUserRole, setCurrentUserRole] = useState<string>('editor');
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);

  // Entities
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [secrets, setSecrets] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<RoomUser[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [remoteDeltas, setRemoteDeltas] = useState<any[]>([]);
  const [latestDelta, setLatestDelta] = useState<any | null>(null);
  const [latestPresence, setLatestPresence] = useState<any | null>(null);

  // UI state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [showHeistModal, setShowHeistModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showDeleteRoomModal, setShowDeleteRoomModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showKickModal, setShowKickModal] = useState(false);
  const [memberToKick, setMemberToKick] = useState<any | null>(null);
  const [showRoomSettingsModal, setShowRoomSettingsModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewSource, setPreviewSource] = useState<any | null>(null);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const uploadingSourceLockRef = useRef(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [bannerNotification, setBannerNotification] = useState<string | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<string>('approvals');

  // Resizable Panels Configuration & State
  const DEFAULT_LEFT_WIDTH = 272;
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 460;

  const DEFAULT_RIGHT_WIDTH = 320;
  const MIN_RIGHT_WIDTH = 260;
  const MAX_RIGHT_WIDTH = 500;

  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = localStorage.getItem('vaultroom_sidebar_left_width');
    const val = saved ? Number(saved) : DEFAULT_LEFT_WIDTH;
    return val >= MIN_LEFT_WIDTH && val <= MAX_LEFT_WIDTH ? val : DEFAULT_LEFT_WIDTH;
  });

  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = localStorage.getItem('vaultroom_sidebar_right_width');
    const val = saved ? Number(saved) : DEFAULT_RIGHT_WIDTH;
    return val >= MIN_RIGHT_WIDTH && val <= MAX_RIGHT_WIDTH ? val : DEFAULT_RIGHT_WIDTH;
  });

  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('vaultroom_sidebar_left_collapsed') === 'true';
  });

  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('vaultroom_sidebar_right_collapsed') === 'true';
  });

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  });

  useEffect(() => {
    const handleWindowResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const baseLeftWidthRef = useRef(leftWidth);
  const baseRightWidthRef = useRef(rightWidth);

  const handleStartLeftResize = () => {
    baseLeftWidthRef.current = leftWidth;
  };

  const handleLeftResize = (delta: number) => {
    const next = Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, baseLeftWidthRef.current + delta));
    setLeftWidth(next);
  };

  const handleEndLeftResize = () => {
    localStorage.setItem('vaultroom_sidebar_left_width', String(leftWidth));
  };

  const handleResetLeft = () => {
    setLeftWidth(DEFAULT_LEFT_WIDTH);
    localStorage.setItem('vaultroom_sidebar_left_width', String(DEFAULT_LEFT_WIDTH));
  };

  const handleStartRightResize = () => {
    baseRightWidthRef.current = rightWidth;
  };

  const handleRightResize = (delta: number) => {
    // Moving pointer left (negative delta) increases right panel width
    const next = Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, baseRightWidthRef.current - delta));
    setRightWidth(next);
  };

  const handleEndRightResize = () => {
    localStorage.setItem('vaultroom_sidebar_right_width', String(rightWidth));
  };

  const handleResetRight = () => {
    setRightWidth(DEFAULT_RIGHT_WIDTH);
    localStorage.setItem('vaultroom_sidebar_right_width', String(DEFAULT_RIGHT_WIDTH));
  };

  const handleToggleLeftSidebar = () => {
    setIsLeftCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('vaultroom_sidebar_left_collapsed', String(next));
      return next;
    });
  };

  const handleToggleRightSidebar = () => {
    setIsRightCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('vaultroom_sidebar_right_collapsed', String(next));
      return next;
    });
  };

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle left sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !e.shiftKey && !e.altKey) {
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable);
        if (!isInput) {
          e.preventDefault();
          handleToggleLeftSidebar();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const wsRef = useRef<VaultWebSocket | null>(null);
  const wsRoomCodeRef = useRef<string | null>(null);

  // Restore active room from saved session
  const restoreActiveRoom = async () => {
    const savedCode = localStorage.getItem('vaultroom_active_room_code');
    if (!savedCode) return;

    const savedPass = await secureStorage.get(`room-pass-${savedCode}`);
    if (!savedPass) return;

    try {
      const roomData = await api.getRoom(savedCode);
      const { key } = await deriveRoomKey(savedPass, savedCode);
      await handleRoomJoined(roomData, key, savedPass);
    } catch (err: any) {
      if (err.status === 404 || err.status === 403 || (err.message && (err.message.includes('404') || err.message.includes('403')))) {
        localStorage.removeItem('vaultroom_active_room_code');
        void secureStorage.delete(`room-pass-${savedCode}`);
      }
    }
  };

  // Initial Auth Check
  useEffect(() => {
    const token = api.getToken();
    if (token) {
      api.getMe()
        .then((userData) => {
          setUser(userData);
          restoreActiveRoom();
        })
        .catch((err: any) => {
          if (err.status === 401 || (err.message && err.message.includes('401'))) {
            api.setToken(null);
            setUser(null);
          }
        })
        .finally(() => {
          setCheckingAuth(false);
        });
    } else {
      setCheckingAuth(false);
    }
  }, []);

  // Initialize Room Data & WebSocket on Room Join
  useEffect(() => {
    if (!roomCode || !user) return;

    const token = api.getToken();
    if (!token) return;

    // Connect WebSocket
    const ws = new VaultWebSocket(roomCode, token);
    wsRef.current = ws;
    wsRoomCodeRef.current = roomCode;

    ws.onStateChange((state) => {
      setConnectionState(state);
      if (state !== 'connected') {
        setLatestPresence(null);
      }
    });

    // Listen to real-time broadcasts
    ws.on('ROOM_CONNECTED', (data) => {
      if (data.online_users) setOnlineUsers(data.online_users);
      refreshMembers();
    });

    ws.on('USER_JOINED', (data) => {
      if (data.online_users) setOnlineUsers(data.online_users);
      refreshMembers();
      addAuditEvent({
        id: `ev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: data.username,
        event_type: 'USER_JOINED',
        severity: 'info',
        details: { role: data.role },
        is_simulated: false,
      });
    });

    ws.on('USER_LEFT', (data) => {
      if (data.online_users) setOnlineUsers(data.online_users);
      setLatestPresence((prev: any) =>
        prev && ((data.user_id && prev.user_id === data.user_id) || (data.username && prev.username === data.username))
          ? null
          : prev
      );
      refreshMembers();
      addAuditEvent({
        id: `ev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: data.username,
        event_type: 'USER_LEFT',
        severity: 'info',
        details: {},
        is_simulated: false,
      });
    });

    ws.on('ROOM_LOCK_STATE_CHANGED', (data) => {
      setIsLocked(data.is_locked);
      setLockReason(data.lock_reason);
      addAuditEvent({
        id: `ev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: data.by_username || 'System',
        event_type: data.is_locked ? 'ROOM_LOCKED' : 'ROOM_UNLOCKED',
        severity: data.is_locked ? 'critical' : 'info',
        details: { reason: data.lock_reason },
        is_simulated: false,
      });
    });

    ws.on('DOCUMENT_CREATED', (data) => {
      if (data && data.doc_id && data.title) {
        setDocuments((prev) => {
          if (prev.some((d) => d.id === data.doc_id)) return prev;
          return [
            ...prev,
            {
              id: data.doc_id,
              title: data.title,
              doc_type: data.doc_type || 'document',
              language: data.language || 'markdown',
              is_protected: !!data.is_protected,
              version: data.version || 1,
              has_content: !!data.encrypted_envelope,
              encrypted_envelope: data.encrypted_envelope,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ];
        });
        setActiveDocId((current) => current || data.doc_id);
      }
      refreshDocuments();
      addAuditEvent({
        id: `ev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: data.created_by,
        event_type: 'DOCUMENT_CREATED',
        severity: 'info',
        details: { title: data.title },
        is_simulated: false,
      });
    });

    ws.on('DOCUMENT_DELETED', () => {
      refreshDocuments();
    });

    ws.on('DOCUMENT_UPDATED', (data) => {
      console.log(`[App] DOCUMENT_UPDATED received for: ${data.doc_id}`);
      if (data && data.doc_id) {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === data.doc_id
              ? {
                  ...d,
                  title: data.title ?? d.title,
                  version: data.version ?? (d.version + 1),
                  encrypted_envelope: data.encrypted_envelope ?? d.encrypted_envelope,
                  has_content: true,
                  updated_at: data.updated_at ?? new Date().toISOString(),
                }
              : d
          )
        );
      }
      refreshDocuments();
    });

    const handleIncomingDelta = (data: any) => {
      setLatestDelta(data);
      setRemoteDeltas((prev) => [...prev.slice(-999), data]);
    };

    ws.on('YJS_UPDATE', handleIncomingDelta);
    ws.on('ENCRYPTED_DELTA', handleIncomingDelta);
    ws.on('DOC_SYNC_STEP', handleIncomingDelta);

    ws.on('CURSOR_UPDATE', (data) => {
      setLatestPresence(data);
    });

    ws.on('AUTH_EXPIRED', () => {
      api.setToken(null);
      setUser(null);
    });

    ws.on('KICKED_FROM_ROOM', (data) => {
      console.warn('[App] KICKED_FROM_ROOM received:', data);
      if (roomCode) {
        localStorage.removeItem('vaultroom_active_room_code');
        void secureStorage.delete(`room-pass-${roomCode}`);
        localStorage.removeItem(`vaultroom_doc_${roomCode}`);
      }
      wsRef.current?.disconnect();
      setRoomCode(null);
      setRoomKey(null);
      setDocuments([]);
      setActiveDocId(null);
      setMembers([]);
      setOnlineUsers([]);
      setLatestPresence(null);
      setBannerNotification(data.message || 'You have been removed from this room by the host.');
    });

    ws.on('MEMBER_KICKED', (data) => {
      console.info('[App] MEMBER_KICKED received:', data);
      if (user && data.user_id === user.id) {
        if (roomCode) {
          localStorage.removeItem('vaultroom_active_room_code');
          void secureStorage.delete(`room-pass-${roomCode}`);
          localStorage.removeItem(`vaultroom_doc_${roomCode}`);
        }
        wsRef.current?.disconnect();
        setRoomCode(null);
        setRoomKey(null);
        setDocuments([]);
        setActiveDocId(null);
        setMembers([]);
        setOnlineUsers([]);
        setLatestPresence(null);
        setBannerNotification(data.reason || 'You have been removed from this room by the host.');
      } else {
        setOnlineUsers((prev) => prev.filter((u) => u.user_id !== data.user_id));
        setLatestPresence((prev: any) =>
          prev && (prev.user_id === data.user_id || prev.username === data.username) ? null : prev
        );
        refreshMembers();
        addAuditEvent({
          id: `ev-${Date.now()}`,
          timestamp: new Date().toISOString(),
          username: data.by_username || 'Host',
          event_type: 'MEMBER_KICKED',
          severity: 'warning',
          details: {
            kicked_user: data.username,
            reason: data.reason
          },
          is_simulated: false,
        });
      }
    });

    ws.on('MEMBER_ROLE_UPDATED', (data) => {
      console.info('[App] MEMBER_ROLE_UPDATED received:', data);
      setMembers((prev) =>
        prev.map((m) => (m.user_id === data.user_id ? { ...m, role: data.new_role } : m))
      );
      if (user && data.user_id === user.id) {
        setCurrentUserRole(data.new_role);
      }
      refreshMembers();
    });

    ws.on('ROOM_SETTINGS_UPDATED', (data) => {
      console.info('[App] ROOM_SETTINGS_UPDATED received:', data);
      if (data.max_members) setMaxMembers(data.max_members);
      if (data.name) setRoomName(data.name);
    });

    ws.on('ROOM_DELETED', (data) => {
      console.warn('[App] ROOM_DELETED received:', data);
      if (roomCode) {
        localStorage.removeItem('vaultroom_active_room_code');
        void secureStorage.delete(`room-pass-${roomCode}`);
        localStorage.removeItem(`vaultroom_doc_${roomCode}`);
      }
      wsRef.current?.disconnect();
      setRoomCode(null);
      setRoomKey(null);
      setDocuments([]);
      setActiveDocId(null);
      setMembers([]);
      setOnlineUsers([]);
      setLatestPresence(null);
      setBannerNotification(data.message || 'This room has been permanently deleted by the host.');
    });

    ws.on('AUTH_REVOKED', (data) => {
      console.warn('[App] AUTH_REVOKED received:', data);
      api.setToken(null);
      setUser(null);
      setRoomCode(null);
      setRoomKey(null);
      setLatestPresence(null);
      setBannerNotification(data.message || 'Your account credentials have been revoked.');
    });

    ws.on('THRESHOLD_APPROVAL_REQUESTED', () => {
      refreshApprovals();
    });

    ws.on('THRESHOLD_APPROVAL_UPDATED', () => {
      refreshApprovals();
    });

    ws.on('SECRET_ADDED', () => {
      refreshSecrets();
    });

    ws.on('SOURCE_ADDED', (data) => {
      if (data && data.source && data.source.id) {
        setSources((prev) => upsertSource(prev, data.source));
      } else {
        refreshSources();
      }
    });

    ws.on('SOURCE_REMOVED', (data) => {
      if (data && data.source_id) {
        setSources((prev) => removeSourceById(prev, data.source_id));
      } else {
        refreshSources();
      }
    });

    ws.on('SECURITY_ANOMALY_ALERT', (data) => {
      addAuditEvent({
        id: `ev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: 'Anomaly Guard',
        event_type: 'ANOMALY_ALERT',
        severity: data.severity,
        details: {
          threat_score: data.threat_score,
          vector: data.dominant_signal,
        },
        is_simulated: data.is_simulated,
      });
    });

    ws.connect();

    // Fetch initial room resources
    refreshMembers();
    refreshDocuments();
    refreshSources();
    refreshSecrets();
    refreshApprovals();
    refreshAuditEvents();

    return () => {
      ws.disconnect();
      if (wsRef.current === ws) {
        wsRef.current = null;
        wsRoomCodeRef.current = null;
      }
    };
  }, [roomCode, user]);

  const addAuditEvent = (event: any) => {
    setAuditEvents((prev) => [event, ...prev.slice(0, 100)]);
  };

  const refreshMembers = async () => {
    if (!roomCode) return;
    try {
      const roomData = await api.getRoom(roomCode);
      if (roomData.members) setMembers(roomData.members);
      if (roomData.online_users) setOnlineUsers(roomData.online_users);
    } catch {}
  };

  const refreshDocuments = async () => {
    if (!roomCode) return;
    try {
      const docs = await api.listDocuments(roomCode);
      setDocuments((prev) => {
        return docs.map((newDoc: any) => {
          const existing = prev.find((p) => p.id === newDoc.id);
          return {
            ...newDoc,
            encrypted_envelope: newDoc.encrypted_envelope ?? existing?.encrypted_envelope,
          };
        });
      });
      if (docs.length > 0) {
        const savedDoc = localStorage.getItem(`vaultroom_doc_${roomCode}`);
        if (savedDoc && docs.some((d: any) => d.id === savedDoc)) {
          setActiveDocId(savedDoc);
        } else if (!activeDocId) {
          setActiveDocId(docs[0].id);
        }
      }
    } catch {}
  };

  const refreshSources = async () => {
    if (!roomCode) return;
    try {
      const s = await api.listSources(roomCode);
      setSources(dedupeSources(Array.isArray(s) ? s : []));
    } catch {}
  };

  const refreshSecrets = async () => {
    if (!roomCode) return;
    try {
      const sec = await api.listSecrets(roomCode);
      setSecrets(sec);
    } catch {}
  };

  const refreshApprovals = async () => {
    if (!roomCode) return;
    try {
      const a = await api.listApprovals(roomCode);
      setApprovals(a);
    } catch {}
  };

  const refreshAuditEvents = async () => {
    if (!roomCode) return;
    try {
      const evts = await api.getAuditTrail(roomCode);
      setAuditEvents(evts);
    } catch {}
  };

  const handleRoomJoined = async (roomData: any, key: CryptoKey, passphrase?: string) => {
    const r = roomData.room || roomData;
    const code = r.code;
    if (code && code !== roomCode) {
      // A room is a separate client session: do not let snapshots, presence,
      // selection, or activity from the previous room bleed into the next one.
      setDocuments([]);
      setActiveDocId(localStorage.getItem(`vaultroom_doc_${code}`));
      setSources([]);
      setSecrets([]);
      setApprovals([]);
      setMembers([]);
      setOnlineUsers([]);
      setAuditEvents([]);
      setRemoteDeltas([]);
      setLatestDelta(null);
      setLatestPresence(null);
      setHasUnsavedChanges(false);
    }
    setRoomCode(code);
    setRoomName(r.name);
    setIsLocked(!!r.is_locked);
    setLockReason(r.lock_reason || null);
    setMaxMembers(r.max_members || roomData.max_members || 20);
    setThresholdRequired(r.threshold_required || 2);
    setThresholdTotal(r.threshold_total || 3);
    setCurrentUserRole(roomData.current_user_role || roomData.membership?.role || 'editor');
    setRoomKey(key);
    if (roomData.members) setMembers(roomData.members);
    if (roomData.online_users) setOnlineUsers(roomData.online_users);

    if (code) {
      localStorage.setItem('vaultroom_active_room_code', code);
      if (passphrase) {
        await secureStorage.set(`room-pass-${code}`, passphrase);
      }
    }
  };

  const handleKickMemberConfirm = async (reason: string) => {
    if (!roomCode || !memberToKick) return;
    try {
      await api.kickMember(roomCode, memberToKick.user_id, reason);
      setMembers((prev) => prev.filter((m) => m.user_id !== memberToKick.user_id));
      setOnlineUsers((prev) => prev.filter((u) => u.user_id !== memberToKick.user_id));
      setShowKickModal(false);
      setBannerNotification(`Removed ${memberToKick.username} from room.`);
      setMemberToKick(null);
    } catch (err: any) {
      alert(err.message || 'Failed to remove member');
    }
  };

  const handleUpdateRoomSettingsConfirm = async (settings: { name?: string; max_members?: number }) => {
    if (!roomCode) return;
    try {
      const res = await api.updateRoomSettings(roomCode, settings);
      if (res.max_members) setMaxMembers(res.max_members);
      if (res.name) setRoomName(res.name);
      setShowRoomSettingsModal(false);
      setBannerNotification('Room capacity and settings updated successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to update settings');
    }
  };

  // Actions
  const handleCreateDocument = async (title: string, docType: string, language?: string) => {
    if (!roomCode || !roomKey) return;
    try {
      const initialContent = docType === 'code' ? '// Start coding...' : `# ${title}\n\n`;
      const env = await encryptEnvelope(initialContent, roomKey);
      const newDoc = await api.createDocument(roomCode, {
        title,
        doc_type: docType,
        language,
        encrypted_envelope: JSON.stringify(env),
      });
      setDocuments((prev) => [...prev, newDoc]);
      setActiveDocId(newDoc.id);
    } catch (err: any) {
      alert(`Error creating document: ${err.message}`);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!roomCode) return;
    try {
      await api.deleteDocument(roomCode, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (activeDocId === docId) {
        setActiveDocId(null);
      }
    } catch (err: any) {
      alert(`Error deleting document: ${err.message}`);
    }
  };

  const handleBroadcastDelta = useCallback((docId: string, updateId: string, encryptedPayload: string) => {
    if (wsRef.current && wsRoomCodeRef.current === roomCode) {
      return wsRef.current.sendAndWaitForPersistence({
        type: 'YJS_UPDATE',
        document_id: docId,
        update_id: updateId,
        encrypted_payload: encryptedPayload,
      });
    }
    return Promise.reject(new Error('The room WebSocket is not connected; the encrypted update is retained for retry'));
  }, [roomCode]);

  const handleBroadcastPresence = useCallback((presenceData: any) => {
    if (wsRef.current && (!wsRoomCodeRef.current || !roomCode || wsRoomCodeRef.current.toUpperCase() === roomCode.toUpperCase())) {
      wsRef.current.send({
        type: 'CURSOR_UPDATE',
        cursor: presenceData,
      });
    }
  }, [roomCode]);

  const handleAddTextSource = async (title: string, content: string, sourceType: string) => {
    if (!roomCode) return;
    try {
      const s = await api.addTextSource(roomCode, { title, content, source_type: sourceType });
      setSources((prev) => upsertSource(prev, s));
    } catch (err: any) {
      alert(`Error adding source: ${err.message}`);
    }
  };

  const handleAddUrlSource = async (title: string, url: string) => {
    if (!roomCode) return;
    try {
      const s = await api.addUrlSource(roomCode, { title, url });
      setSources((prev) => upsertSource(prev, s));
    } catch (err: any) {
      alert(`Error adding URL source: ${err.message}`);
    }
  };

  const handleUploadSource = async (file: File) => {
    if (!roomCode || uploadingSourceLockRef.current) return;
    uploadingSourceLockRef.current = true;
    setIsUploadingSource(true);
    const uploadId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const s = await api.uploadFileSource(roomCode, file, undefined, uploadId);
      setSources((prev) => upsertSource(prev, s));
    } catch (err: any) {
      alert(`Error uploading file: ${err.message}`);
    } finally {
      uploadingSourceLockRef.current = false;
      setIsUploadingSource(false);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!roomCode) return;
    try {
      await api.deleteSource(roomCode, sourceId);
      setSources((prev) => removeSourceById(prev, sourceId));
    } catch (err: any) {
      alert(`Error deleting source: ${err.message}`);
    }
  };

  const handleAddSecret = async (name: string, category: string, value: string, desc?: string) => {
    if (!roomCode || !roomKey) return;
    try {
      const env = await encryptEnvelope(value, roomKey);
      const sec = await api.addSecret(roomCode, {
        name,
        category,
        encrypted_value: env.ciphertext,
        iv: env.iv,
        description: desc,
      });
      setSecrets((prev) => [sec, ...prev]);
    } catch (err: any) {
      alert(`Error adding secret: ${err.message}`);
    }
  };

  const handleRevealSecret = async (secretId: string): Promise<string | null> => {
    if (!roomCode || !roomKey) return null;
    try {
      const res = await api.revealSecret(roomCode, secretId);
      const decrypted = await decryptEnvelope(
        {
          v: 1,
          iv: res.iv,
          ciphertext: res.encrypted_value,
        },
        roomKey
      );
      return decrypted;
    } catch (err: any) {
      alert(`Decryption failed: ${err.message}. Ensure you have Key Holder permissions.`);
      return null;
    }
  };

  const handleDeleteSecret = async (secretId: string) => {
    if (!roomCode) return;
    try {
      await api.deleteSecret(roomCode, secretId);
      setSecrets((prev) => prev.filter((s) => s.id !== secretId));
    } catch (err: any) {
      alert(`Error deleting secret: ${err.message}`);
    }
  };

  const handleVoteApproval = async (approvalId: string, decision: 'approve' | 'reject') => {
    if (!roomCode) return;
    try {
      await api.voteApproval(roomCode, approvalId, decision);
      refreshApprovals();
    } catch (err: any) {
      alert(`Voting error: ${err.message}`);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    if (!roomCode) return;
    try {
      await api.updateRole(roomCode, userId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m))
      );
    } catch (err: any) {
      alert(`Role update error: ${err.message}`);
    }
  };

  const handleToggleLock = async () => {
    if (!roomCode) return;
    try {
      const nextLocked = !isLocked;
      const res = await api.toggleLock(roomCode, nextLocked, 'Manual administrator lockdown toggle');
      setIsLocked(res.is_locked);
      setLockReason(res.lock_reason);
    } catch (err: any) {
      alert(`Lockdown error: ${err.message}`);
    }
  };

  const activeDoc = documents.find((d) => d.id === activeDocId) || null;

  if (checkingAuth) {
    return (
      <div className="h-screen w-screen bg-[#090a0f] flex items-center justify-center font-mono text-cyan-400 text-xs">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping mr-2" />
        <span>Initializing VaultRoom...</span>
      </div>
    );
  }

  const handleConfirmSignOut = () => {
    if (roomCode) {
      localStorage.removeItem('vaultroom_active_room_code');
      void secureStorage.delete(`room-pass-${roomCode}`);
      localStorage.removeItem(`vaultroom_doc_${roomCode}`);
    }
    wsRef.current?.disconnect();
    api.setToken(null);
    setUser(null);
    setRoomCode(null);
    setRoomKey(null);
    setDocuments([]);
    setMembers([]);
    setOnlineUsers([]);
    setLatestPresence(null);
    setShowSignOutModal(false);
    setHasUnsavedChanges(false);
  };

  const handleConfirmDeleteRoom = async () => {
    if (!roomCode) return;
    const currentCode = roomCode;
    await api.deleteRoom(currentCode);
    localStorage.removeItem('vaultroom_active_room_code');
    void secureStorage.delete(`room-pass-${currentCode}`);
    localStorage.removeItem(`vaultroom_doc_${currentCode}`);
    wsRef.current?.disconnect();
    setRoomCode(null);
    setRoomKey(null);
    setDocuments([]);
    setActiveDocId(null);
    setMembers([]);
    setOnlineUsers([]);
    setLatestPresence(null);
    setShowDeleteRoomModal(false);
    setBannerNotification(`Room ${currentCode} and all its documents were permanently deleted.`);
  };

  const handleConfirmDeleteAccount = async (password: string) => {
    await api.deleteAccount(password);
    if (roomCode) {
      localStorage.removeItem('vaultroom_active_room_code');
      void secureStorage.delete(`room-pass-${roomCode}`);
      localStorage.removeItem(`vaultroom_doc_${roomCode}`);
    }
    wsRef.current?.disconnect();
    api.setToken(null);
    setUser(null);
    setRoomCode(null);
    setRoomKey(null);
    setDocuments([]);
    setMembers([]);
    setOnlineUsers([]);
    setLatestPresence(null);
    setShowDeleteAccountModal(false);
    setBannerNotification('Your account and all associated rooms have been permanently deleted.');
  };

  if (!user) {
    return <AuthModal onSuccess={(u) => setUser(u)} notification={bannerNotification} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#05090b] text-slate-100 overflow-hidden font-sans relative">
      {/* Ambient Cyber Background Layer */}
      <div className="cyber-bg-container pointer-events-none" aria-hidden="true">
        <div className="cyber-bg-overlay pointer-events-none" />
      </div>
      {/* Banner Notification (e.g. room/account deletion alerts) */}
      {bannerNotification && (
        <div className="relative z-50 bg-[#0B1115]/95 border-b border-[#21D4E5]/30 px-4 py-2.5 flex items-center justify-between text-xs font-mono text-[#21D4E5] backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.6)] animate-fadeIn">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#21D4E5] shadow-[0_0_8px_#21D4E5]" />
            <span>{bannerNotification}</span>
          </div>
          <button
            onClick={() => setBannerNotification(null)}
            className="text-[#21D4E5] hover:text-white px-1.5 py-0.5 rounded hover:bg-[#21D4E5]/10 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Navigation */}
      <div className="relative z-10 shrink-0">
        <Navbar
        roomCode={roomCode}
        roomName={roomName}
        isLocked={isLocked}
        lockReason={lockReason}
        connectionState={connectionState}
        user={user}
        currentUserRole={currentUserRole}
        onLeaveRoom={() => {
          if (roomCode) {
            localStorage.removeItem('vaultroom_active_room_code');
            void secureStorage.delete(`room-pass-${roomCode}`);
            localStorage.removeItem(`vaultroom_doc_${roomCode}`);
          }
          setRoomCode(null);
          setRoomKey(null);
          setDocuments([]);
          setMembers([]);
          setOnlineUsers([]);
          setLatestPresence(null);
        }}
        onLogout={() => setShowSignOutModal(true)}
        onDeleteRoom={() => setShowDeleteRoomModal(true)}
        onOpenDeleteAccount={() => setShowDeleteAccountModal(true)}
        onOpenHeist={() => setShowHeistModal(true)}
        onToggleLock={handleToggleLock}
        activeRightTab={activeRightTab}
        setActiveRightTab={setActiveRightTab}
        isLeftCollapsed={isLeftCollapsed}
        onToggleLeftSidebar={handleToggleLeftSidebar}
        isRightCollapsed={isRightCollapsed}
        onToggleRightSidebar={handleToggleRightSidebar}
      />
      </div>

      {/* Main Workspace Layout */}
      {roomCode ? (
        <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden relative">
            {/* Left Sidebar (Desktop Inline / Mobile Drawer Overlay) */}
            {!isLeftCollapsed && (
              isMobile ? (
                <div className="fixed inset-0 z-40 flex">
                  <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={handleToggleLeftSidebar}
                  />
                  <div className="relative z-50 h-full max-w-[85vw] shadow-2xl">
                    <Sidebar
                      width={Math.min(leftWidth, typeof window !== 'undefined' ? window.innerWidth * 0.85 : 300)}
                      isCollapsed={isLeftCollapsed}
                      onToggleCollapse={handleToggleLeftSidebar}
                      roomCode={roomCode}
                      documents={documents}
                      activeDocId={activeDocId}
                      onSelectDoc={(id) => {
                        setLatestPresence(null);
                        setActiveDocId(id);
                        if (roomCode) localStorage.setItem(`vaultroom_doc_${roomCode}`, id);
                        handleToggleLeftSidebar();
                      }}
                      onCreateDoc={handleCreateDocument}
                      onDeleteDoc={handleDeleteDocument}
                      sources={sources}
                      onAddTextSource={handleAddTextSource}
                      onAddUrlSource={handleAddUrlSource}
                      onUploadSource={handleUploadSource}
                      uploadingSource={isUploadingSource}
                      onDeleteSource={handleDeleteSource}
                      onOpenSourcePreview={(source) => {
                        setPreviewSource(source);
                        setShowPreviewModal(true);
                      }}
                      secrets={secrets}
                      onAddSecret={handleAddSecret}
                      onRevealSecret={handleRevealSecret}
                      onDeleteSecret={handleDeleteSecret}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <Sidebar
                    width={leftWidth}
                    isCollapsed={isLeftCollapsed}
                    onToggleCollapse={handleToggleLeftSidebar}
                    roomCode={roomCode}
                    documents={documents}
                    activeDocId={activeDocId}
                    onSelectDoc={(id) => {
                      setLatestPresence(null);
                      setActiveDocId(id);
                      if (roomCode) localStorage.setItem(`vaultroom_doc_${roomCode}`, id);
                    }}
                    onCreateDoc={handleCreateDocument}
                    onDeleteDoc={handleDeleteDocument}
                    sources={sources}
                    onAddTextSource={handleAddTextSource}
                    onAddUrlSource={handleAddUrlSource}
                    onUploadSource={handleUploadSource}
                    uploadingSource={isUploadingSource}
                    onDeleteSource={handleDeleteSource}
                    onOpenSourcePreview={(source) => {
                      setPreviewSource(source);
                      setShowPreviewModal(true);
                    }}
                    secrets={secrets}
                    onAddSecret={handleAddSecret}
                    onRevealSecret={handleRevealSecret}
                    onDeleteSecret={handleDeleteSecret}
                  />
                  <ResizeDivider
                    direction="vertical"
                    ariaLabel="Left sidebar resizer"
                    title="Drag to resize left sidebar · Double-click to reset"
                    onResizeStart={handleStartLeftResize}
                    onResize={handleLeftResize}
                    onResizeEnd={handleEndLeftResize}
                    onReset={handleResetLeft}
                  />
                </>
              )
            )}

            {/* Central Editor Canvas */}
            <EditorView
              key={`${roomCode}:${activeDocId || 'empty'}`}
              document={activeDoc}
              roomCode={roomCode}
              roomKey={roomKey}
              isLocked={isLocked}
              currentUserRole={currentUserRole}
              currentUserId={user?.id}
              currentUsername={user?.username}
              onlineUsers={onlineUsers}
              onBroadcastDelta={handleBroadcastDelta}
              onBroadcastPresence={handleBroadcastPresence}
              latestPresence={latestPresence}
              onSaveStatusChange={(status) => setHasUnsavedChanges(status === 'unsaved')}
              latestDelta={latestDelta}
              remoteDeltas={remoteDeltas}
              connectionState={connectionState}
            />

            {/* Right Sidebar (Desktop Inline / Mobile Drawer Overlay) */}
            {!isRightCollapsed && (
              isMobile ? (
                <div className="fixed inset-0 z-40 flex justify-end">
                  <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={handleToggleRightSidebar}
                  />
                  <div className="relative z-50 h-full max-w-[85vw] shadow-2xl">
                    <RightSidebar
                      width={Math.min(rightWidth, typeof window !== 'undefined' ? window.innerWidth * 0.85 : 320)}
                      isCollapsed={isRightCollapsed}
                      onToggleCollapse={handleToggleRightSidebar}
                      roomCode={roomCode}
                      thresholdRequired={thresholdRequired}
                      thresholdTotal={thresholdTotal}
                      maxMembers={maxMembers}
                      members={members}
                      onlineUsers={onlineUsers}
                      currentUserRole={currentUserRole}
                      currentUserId={user?.id}
                      approvals={approvals}
                      onVoteApproval={handleVoteApproval}
                      onUpdateRole={handleUpdateRole}
                      onRequestKickMember={(m) => {
                        setMemberToKick(m);
                        setShowKickModal(true);
                      }}
                      onOpenSettings={() => setShowRoomSettingsModal(true)}
                      onStartHeist={() => setShowHeistModal(true)}
                      onEvaluateAnomaly={(metrics) => api.evaluateAnomaly(roomCode, metrics)}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <ResizeDivider
                    direction="vertical"
                    ariaLabel="Right sidebar resizer"
                    title="Drag to resize right sidebar · Double-click to reset"
                    onResizeStart={handleStartRightResize}
                    onResize={handleRightResize}
                    onResizeEnd={handleEndRightResize}
                    onReset={handleResetRight}
                  />
                  <RightSidebar
                    width={rightWidth}
                    isCollapsed={isRightCollapsed}
                    onToggleCollapse={handleToggleRightSidebar}
                    roomCode={roomCode}
                    thresholdRequired={thresholdRequired}
                    thresholdTotal={thresholdTotal}
                    maxMembers={maxMembers}
                    members={members}
                    onlineUsers={onlineUsers}
                    currentUserRole={currentUserRole}
                    currentUserId={user?.id}
                    approvals={approvals}
                    onVoteApproval={handleVoteApproval}
                    onUpdateRole={handleUpdateRole}
                    onRequestKickMember={(m) => {
                      setMemberToKick(m);
                      setShowKickModal(true);
                    }}
                    onOpenSettings={() => setShowRoomSettingsModal(true)}
                    onStartHeist={() => setShowHeistModal(true)}
                    onEvaluateAnomaly={(metrics) => api.evaluateAnomaly(roomCode, metrics)}
                  />
                </>
              )
            )}
          </div>

          {/* Collapsible Terminal Audit Feed */}
          <ActivityFeed events={auditEvents} isLocked={isLocked} />
        </div>
      ) : (
        /* Room Join / Lobby Screen */
        <div className="relative z-10 flex-1 flex overflow-hidden">
          <RoomModal
            isOpen={true}
            user={user}
            onRoomJoined={handleRoomJoined}
            onLogout={() => setShowSignOutModal(true)}
            onOpenDeleteAccount={() => setShowDeleteAccountModal(true)}
          />
        </div>
      )}

      {/* Heist Mode 30-Second Security Simulation Modal */}
      {roomCode && (
        <HeistModal
          roomCode={roomCode}
          isOpen={showHeistModal}
          onClose={() => setShowHeistModal(false)}
          onLockEngaged={(locked, reason) => {
            setIsLocked(locked);
            setLockReason(reason || null);
          }}
        />
      )}

      {/* Sign-Out Confirmation Modal */}
      <SignOutModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleConfirmSignOut}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* Host-Only Room Deletion Modal */}
      {roomCode && (
        <DeleteRoomModal
          isOpen={showDeleteRoomModal}
          roomCode={roomCode}
          onClose={() => setShowDeleteRoomModal(false)}
          onConfirm={handleConfirmDeleteRoom}
        />
      )}

      {/* Account Deletion Modal */}
      <DeleteAccountModal
        isOpen={showDeleteAccountModal}
        username={user?.username || ''}
        onClose={() => setShowDeleteAccountModal(false)}
        onConfirm={handleConfirmDeleteAccount}
      />

      {/* Member Removal (Kick) Confirmation Modal */}
      <KickMemberModal
        isOpen={showKickModal}
        targetUsername={memberToKick?.username || ''}
        roomCode={roomCode || ''}
        onClose={() => {
          setShowKickModal(false);
          setMemberToKick(null);
        }}
        onConfirm={handleKickMemberConfirm}
      />

      {/* Room Settings & Capacity Modal */}
      {roomCode && (
        <RoomSettingsModal
          isOpen={showRoomSettingsModal}
          roomCode={roomCode}
          currentName={roomName || ''}
          currentMaxMembers={maxMembers}
          onClose={() => setShowRoomSettingsModal(false)}
          onConfirm={handleUpdateRoomSettingsConfirm}
        />
      )}

      {/* Document & Source Preview Modal (PDF, DOCX, Code, Text) */}
      <DocumentPreviewModal
        isOpen={showPreviewModal}
        source={previewSource}
        roomCode={roomCode || ''}
        roomKey={roomKey}
        onClose={() => {
          setShowPreviewModal(false);
          setPreviewSource(null);
        }}
      />
    </div>
  );
}

export default App;
