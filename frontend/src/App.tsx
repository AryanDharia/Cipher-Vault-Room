import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { RightSidebar } from './components/RightSidebar';
import { EditorView } from './components/EditorView';
import { ActivityFeed } from './components/ActivityFeed';
import { HeistModal } from './components/HeistModal';
import { AuthModal } from './components/AuthModal';
import { RoomModal } from './components/RoomModal';
import { api } from './lib/api';
import { VaultWebSocket, ConnectionState, RoomUser } from './lib/websocket';
import { encryptEnvelope, decryptEnvelope, deriveRoomKey } from './lib/crypto';

export function App() {
  // Authentication & User State
  const [user, setUser] = useState<any | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Room State
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
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

  // UI state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [showHeistModal, setShowHeistModal] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<string>('approvals');

  const wsRef = useRef<VaultWebSocket | null>(null);

  // Restore active room from saved session
  const restoreActiveRoom = async () => {
    const savedCode = localStorage.getItem('vaultroom_active_room_code');
    if (!savedCode) return;

    const savedPass = sessionStorage.getItem(`vaultroom_pass_${savedCode}`) || localStorage.getItem(`vaultroom_pass_${savedCode}`);
    if (!savedPass) return;

    try {
      const roomData = await api.getRoom(savedCode);
      const { key } = await deriveRoomKey(savedPass, savedCode);
      handleRoomJoined(roomData, key, savedPass);
    } catch (err: any) {
      if (err.status === 404 || err.status === 403 || (err.message && (err.message.includes('404') || err.message.includes('403')))) {
        localStorage.removeItem('vaultroom_active_room_code');
        localStorage.removeItem(`vaultroom_pass_${savedCode}`);
        sessionStorage.removeItem(`vaultroom_pass_${savedCode}`);
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

    ws.onStateChange((state) => {
      setConnectionState(state);
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

    ws.on('MEMBER_ROLE_UPDATED', (data) => {
      setMembers((prev) =>
        prev.map((m) => (m.user_id === data.user_id ? { ...m, role: data.new_role } : m))
      );
      if (user && user.id === data.user_id) {
        setCurrentUserRole(data.new_role);
      }
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

    const handleIncomingDelta = (data: any) => {
      setRemoteDeltas((prev) => [...prev, data]);
    };

    ws.on('YJS_UPDATE', handleIncomingDelta);
    ws.on('ENCRYPTED_DELTA', handleIncomingDelta);
    ws.on('DOC_SYNC_STEP', handleIncomingDelta);

    ws.on('THRESHOLD_APPROVAL_REQUESTED', () => {
      refreshApprovals();
    });

    ws.on('THRESHOLD_APPROVAL_UPDATED', () => {
      refreshApprovals();
    });

    ws.on('SECRET_ADDED', () => {
      refreshSecrets();
    });

    ws.on('SOURCE_ADDED', () => {
      refreshSources();
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
      setDocuments(docs);
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
      setSources(s);
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

  const handleRoomJoined = (roomData: any, key: CryptoKey, passphrase?: string) => {
    const r = roomData.room || roomData;
    const code = r.code;
    setRoomCode(code);
    setRoomName(r.name);
    setIsLocked(!!r.is_locked);
    setLockReason(r.lock_reason || null);
    setThresholdRequired(r.threshold_required || 2);
    setThresholdTotal(r.threshold_total || 3);
    setCurrentUserRole(roomData.current_user_role || roomData.membership?.role || 'editor');
    setRoomKey(key);
    if (roomData.members) setMembers(roomData.members);
    if (roomData.online_users) setOnlineUsers(roomData.online_users);

    if (code) {
      localStorage.setItem('vaultroom_active_room_code', code);
      if (passphrase) {
        sessionStorage.setItem(`vaultroom_pass_${code}`, passphrase);
        localStorage.setItem(`vaultroom_pass_${code}`, passphrase);
      }
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

  const handleSaveDocument = async (docId: string, encryptedEnvelope: string) => {
    if (!roomCode) return;
    await api.updateDocument(roomCode, docId, { encrypted_envelope: encryptedEnvelope });
  };

  const handleBroadcastDelta = (docId: string, encryptedPayload: string) => {
    if (wsRef.current) {
      wsRef.current.send({
        type: 'YJS_UPDATE',
        document_id: docId,
        encrypted_payload: encryptedPayload,
      });
    }
  };

  const handleAddTextSource = async (title: string, content: string, sourceType: string) => {
    if (!roomCode) return;
    try {
      const s = await api.addTextSource(roomCode, { title, content, source_type: sourceType });
      setSources((prev) => [s, ...prev]);
    } catch (err: any) {
      alert(`Error adding source: ${err.message}`);
    }
  };

  const handleAddUrlSource = async (title: string, url: string) => {
    if (!roomCode) return;
    try {
      const s = await api.addUrlSource(roomCode, { title, url });
      setSources((prev) => [s, ...prev]);
    } catch (err: any) {
      alert(`Error adding URL source: ${err.message}`);
    }
  };

  const handleUploadSource = async (file: File) => {
    if (!roomCode) return;
    try {
      const s = await api.uploadFileSource(roomCode, file);
      setSources((prev) => [s, ...prev]);
    } catch (err: any) {
      alert(`Error uploading file: ${err.message}`);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!roomCode) return;
    try {
      await api.deleteSource(roomCode, sourceId);
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
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

  if (!user) {
    return <AuthModal onSuccess={(u) => setUser(u)} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0b10] text-slate-100 overflow-hidden font-sans">
      {/* Top Navigation */}
      <Navbar
        roomCode={roomCode}
        roomName={roomName}
        isLocked={isLocked}
        lockReason={lockReason}
        connectionState={connectionState}
        user={user}
        onLeaveRoom={() => {
          if (roomCode) {
            localStorage.removeItem('vaultroom_active_room_code');
            localStorage.removeItem(`vaultroom_pass_${roomCode}`);
            sessionStorage.removeItem(`vaultroom_pass_${roomCode}`);
            localStorage.removeItem(`vaultroom_doc_${roomCode}`);
          }
          setRoomCode(null);
          setRoomKey(null);
          setDocuments([]);
          setMembers([]);
          setOnlineUsers([]);
        }}
        onLogout={() => {
          if (roomCode) {
            localStorage.removeItem('vaultroom_active_room_code');
            localStorage.removeItem(`vaultroom_pass_${roomCode}`);
            sessionStorage.removeItem(`vaultroom_pass_${roomCode}`);
            localStorage.removeItem(`vaultroom_doc_${roomCode}`);
          }
          api.setToken(null);
          setUser(null);
          setRoomCode(null);
          setRoomKey(null);
          setDocuments([]);
          setMembers([]);
          setOnlineUsers([]);
        }}
        onOpenHeist={() => setShowHeistModal(true)}
        onToggleLock={handleToggleLock}
        activeRightTab={activeRightTab}
        setActiveRightTab={setActiveRightTab}
      />

      {/* Main Workspace Layout */}
      {roomCode ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden">
            {/* Left Sidebar */}
            <Sidebar
              roomCode={roomCode}
              documents={documents}
              activeDocId={activeDocId}
              onSelectDoc={(id) => {
                setActiveDocId(id);
                if (roomCode) localStorage.setItem(`vaultroom_doc_${roomCode}`, id);
              }}
              onCreateDoc={handleCreateDocument}
              onDeleteDoc={handleDeleteDocument}
              sources={sources}
              onAddTextSource={handleAddTextSource}
              onAddUrlSource={handleAddUrlSource}
              onUploadSource={handleUploadSource}
              onDeleteSource={handleDeleteSource}
              secrets={secrets}
              onAddSecret={handleAddSecret}
              onRevealSecret={handleRevealSecret}
              onDeleteSecret={handleDeleteSecret}
            />

            {/* Central Editor Canvas */}
            <EditorView
              document={activeDoc}
              roomCode={roomCode}
              roomKey={roomKey}
              isLocked={isLocked}
              currentUserRole={currentUserRole}
              onSaveDocument={handleSaveDocument}
              onBroadcastDelta={handleBroadcastDelta}
              remoteDeltas={remoteDeltas}
            />

            {/* Right Sidebar */}
            <RightSidebar
              roomCode={roomCode}
              thresholdRequired={thresholdRequired}
              thresholdTotal={thresholdTotal}
              members={members}
              onlineUsers={onlineUsers}
              currentUserRole={currentUserRole}
              approvals={approvals}
              onVoteApproval={handleVoteApproval}
              onUpdateRole={handleUpdateRole}
              onStartHeist={() => setShowHeistModal(true)}
              onEvaluateAnomaly={(metrics) => api.evaluateAnomaly(roomCode, metrics)}
            />
          </div>

          {/* Collapsible Terminal Audit Feed */}
          <ActivityFeed events={auditEvents} isLocked={isLocked} />
        </div>
      ) : (
        /* Room Join / Lobby Screen */
        <RoomModal isOpen={true} onRoomJoined={handleRoomJoined} />
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
    </div>
  );
}

export default App;
