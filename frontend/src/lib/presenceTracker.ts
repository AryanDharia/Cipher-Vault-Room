export interface PresenceUserState {
  userId?: string;
  username: string;
  isTyping: boolean;
  lastActive: number;
  docId?: string;
  roomCode?: string;
}

export interface AwarenessLikeState {
  user?: PresenceUserState;
}

export interface OnlineUserLike {
  user_id?: string;
  username?: string;
}

export function hashClientId(str: string, avoidClientId?: number): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0x7fffffff;
  }
  let result = hash || 1;
  if (avoidClientId !== undefined && result === avoidClientId) {
    result = (result % 0x7ffffffe) + 1;
    if (result === avoidClientId) {
      result = avoidClientId === 1 ? 2 : 1;
    }
  }
  return result;
}

export function isSelfUser(
  entry: { userId?: string; user_id?: string; username?: string },
  currentUserId?: string,
  currentUsername?: string
): boolean {
  const entryId = entry.userId || entry.user_id;
  if (currentUserId && entryId) {
    return entryId === currentUserId;
  }
  if (currentUsername && entry.username) {
    return entry.username.trim().toLowerCase() === currentUsername.trim().toLowerCase();
  }
  return false;
}

export function isEditingKeydown(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  return (
    event.key.length === 1 ||
    event.key === 'Backspace' ||
    event.key === 'Delete' ||
    event.key === 'Enter'
  );
}

export function isLocalTipTapUpdate(
  transaction: { docChanged?: boolean; getMeta?: (key: any) => any } | null | undefined,
  ySyncKey: any
): boolean {
  if (!transaction || !transaction.docChanged) {
    return false;
  }
  const ySyncMeta = transaction.getMeta ? transaction.getMeta(ySyncKey) : undefined;
  if (ySyncMeta && ySyncMeta.isChangeOrigin) {
    return false;
  }
  return true;
}

export function applyRemotePresenceToMap(
  states: Map<number, AwarenessLikeState>,
  localClientId: number,
  payload: any,
  context: {
    currentUserId?: string;
    currentUsername?: string;
    docId?: string;
    roomCode?: string;
    now?: number;
  }
): { changed: boolean; clientId?: number; action?: 'updated' | 'removed' } {
  if (!payload || !payload.cursor) return { changed: false };
  const { user_id, username, cursor } = payload;
  if (!username && !user_id) return { changed: false };

  const payloadRoom = payload.room_code || payload.roomCode;
  if (payloadRoom && context.roomCode && payloadRoom.toUpperCase() !== context.roomCode.toUpperCase()) {
    return { changed: false };
  }

  const remoteClientId = hashClientId(user_id || username, localClientId);

  if (isSelfUser({ userId: user_id, username }, context.currentUserId, context.currentUsername)) {
    const hadEntry = states.delete(remoteClientId);
    return hadEntry ? { changed: true, clientId: remoteClientId, action: 'removed' } : { changed: false };
  }

  if (cursor.docId && context.docId && cursor.docId !== context.docId) {
    const removed = states.delete(remoteClientId);
    return removed ? { changed: true, clientId: remoteClientId, action: 'removed' } : { changed: false };
  }

  const now = context.now ?? Date.now();
  states.set(remoteClientId, {
    user: {
      userId: user_id,
      username: username || 'Collaborator',
      isTyping: Boolean(cursor.isTyping),
      lastActive: now,
      docId: cursor.docId,
      roomCode: payloadRoom || context.roomCode,
    },
  });

  return { changed: true, clientId: remoteClientId, action: 'updated' };
}

export function pruneDisconnectedPresence(
  states: Map<number, AwarenessLikeState>,
  localClientId: number,
  onlineUsers?: OnlineUserLike[]
): number[] {
  if (!onlineUsers) return [];
  const onlineIds = new Set(onlineUsers.map((u) => u.user_id).filter(Boolean));
  const onlineNames = new Set(
    onlineUsers
      .map((u) => u.username?.trim().toLowerCase())
      .filter((n): n is string => Boolean(n))
  );

  const removedIds: number[] = [];
  states.forEach((state, cId) => {
    if (cId === localClientId) return;
    const u = state?.user;
    if (!u) return;
    const stillOnline = u.userId
      ? onlineIds.has(u.userId)
      : onlineNames.has((u.username || '').trim().toLowerCase());
    if (!stillOnline) {
      states.delete(cId);
      removedIds.push(cId);
    }
  });
  return removedIds;
}

export function getActiveTypingUsernames(
  states: Map<number, AwarenessLikeState>,
  localClientId: number,
  context: {
    currentUserId?: string;
    currentUsername?: string;
    docId?: string;
    now?: number;
    ttlMs?: number;
  }
): string[] {
  const now = context.now ?? Date.now();
  const ttlMs = context.ttlMs ?? 3000;
  const active: string[] = [];
  const seenKeys = new Set<string>();

  states.forEach((state, cId) => {
    if (cId === localClientId) return;
    const u = state?.user;
    if (!u || !u.username) return;
    if (isSelfUser(u, context.currentUserId, context.currentUsername)) return;
    if (u.docId && context.docId && u.docId !== context.docId) return;

    if (u.isTyping && now - (u.lastActive || 0) < ttlMs) {
      const dedupeKey = u.userId || u.username.trim().toLowerCase();
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        active.push(u.username);
      }
    }
  });

  return active;
}
