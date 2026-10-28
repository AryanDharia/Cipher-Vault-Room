import asyncio
import json
import time
import logging
from typing import Dict, List, Set, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import update, func

from app.rooms.service import normalize_room_code

logger = logging.getLogger("vaultroom.collaboration")
logging.basicConfig(level=logging.INFO)

class RoomConnectionManager:
    """
    Manages active WebSocket connections per room.
    Ensures zero-knowledge update relaying (payloads remain encrypted client-side)
    while managing presence, rate limits, heartbeat watchdog, and room lifecycle cleanup.
    """
    def __init__(self):
        # room_code -> Dict[socket_id, { "ws": WebSocket, "user_id": str, "username": str, "role": str, "connected_at": float, "last_seen": float }]
        self.active_rooms: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # room_code -> Dict[user_id, { "socket_id": str, "username": str, "color": str, "cursor": Any, "selection": Any, "updated_at": float }]
        self.room_presence: Dict[str, Dict[str, Any]] = {}
        # socket_id -> { "count": int, "window_start": float }
        self.rate_limits: Dict[str, Dict[str, Any]] = {}
        self.max_messages_per_second = 100
        self.max_rate_limit_entries = 5000

    def _cleanup_stale_rate_limits(self):
        """Bounded cache hygiene: remove expired rate limit records."""
        now = time.time()
        stale_sids = [
            sid for sid, rec in self.rate_limits.items()
            if now - rec.get("window_start", 0) > 60.0
        ]
        for sid in stale_sids:
            self.rate_limits.pop(sid, None)

        # Hard clamp if still oversized
        if len(self.rate_limits) > self.max_rate_limit_entries:
            # Drop oldest half
            sorted_entries = sorted(self.rate_limits.items(), key=lambda item: item[1].get("window_start", 0))
            for sid, _ in sorted_entries[:len(sorted_entries) // 2]:
                self.rate_limits.pop(sid, None)

    def _check_rate_limit(self, socket_id: str) -> bool:
        now = time.time()
        record = self.rate_limits.setdefault(socket_id, {"count": 0, "window_start": now})
        if now - record["window_start"] > 1.0:
            record["count"] = 0
            record["window_start"] = now
        record["count"] += 1

        if len(self.rate_limits) > 1000:
            self._cleanup_stale_rate_limits()

        return record["count"] <= self.max_messages_per_second

    async def _set_room_active_status(self, room_code: str, is_active: bool):
        """Synchronize the database room active state without blocking in-memory operations."""
        try:
            from app.database.session import AsyncSessionLocal
            from app.database.models import Room
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(Room)
                    .where(func.upper(Room.code) == room_code)
                    .values(is_active=is_active)
                )
                await db.commit()
                logger.info(f"[ROOM DB SYNC] Room '{room_code}' is_active set to {is_active} in database.")
        except Exception as e:
            logger.warning(f"[ROOM DB SYNC ERR] Failed to set is_active={is_active} for room '{room_code}': {e}")

    async def connect(
        self,
        websocket: WebSocket,
        room_code: str,
        socket_id: str,
        user_id: str,
        username: str,
        role: str
    ):
        code = normalize_room_code(room_code)
        try:
            await websocket.accept()
        except Exception:
            pass

        now = time.time()
        was_empty = (code not in self.active_rooms) or (len(self.active_rooms[code]) == 0)

        room_conns = self.active_rooms.setdefault(code, {})
        room_conns[socket_id] = {
            "ws": websocket,
            "user_id": user_id,
            "username": username,
            "role": role,
            "connected_at": now,
            "last_seen": now
        }

        # If this is the first client connecting to an inactive room, activate it in DB
        if was_empty:
            await self._set_room_active_status(code, True)

        logger.info(f"[WS CONNECT] User '{username}' ({user_id}) connected to room '{code}' on socket {socket_id}. Total in room: {len(room_conns)}")

        # Broadcast participant join to all peers in the room
        await self.broadcast(code, {
            "type": "USER_JOINED",
            "socket_id": socket_id,
            "user_id": user_id,
            "username": username,
            "role": role,
            "online_users": self.get_online_users(code)
        }, exclude_socket_id=socket_id)

        # Send current room snapshot & online list directly to newly joined user
        try:
            await websocket.send_json({
                "type": "ROOM_CONNECTED",
                "room_code": code,
                "socket_id": socket_id,
                "online_users": self.get_online_users(code),
                "active_presence": list(self.room_presence.get(code, {}).values())
            })
        except Exception as e:
            logger.warning(f"[WS CONNECT ERR] Failed to send initial snapshot to {socket_id}: {e}")

    async def disconnect(self, room_code: str, socket_id: str):
        code = normalize_room_code(room_code)
        if code in self.active_rooms:
            room_conns = self.active_rooms[code]
            user_info = room_conns.pop(socket_id, None)
            self.rate_limits.pop(socket_id, None)

            if user_info:
                user_id = user_info["user_id"]
                # Clean user presence for this socket if no other sockets remain for that user
                if code in self.room_presence:
                    user_has_other_socket = any(c.get("user_id") == user_id for c in room_conns.values())
                    if not user_has_other_socket:
                        self.room_presence[code].pop(user_id, None)

                logger.info(f"[WS DISCONNECT] User '{user_info.get('username')}' disconnected from room '{code}' (socket {socket_id}). Remaining connections: {len(room_conns)}")

                # Broadcast participant leave
                await self.broadcast(code, {
                    "type": "USER_LEFT",
                    "socket_id": socket_id,
                    "user_id": user_id,
                    "username": user_info["username"],
                    "online_users": self.get_online_users(code)
                })

            # Check if room is now completely empty
            if not room_conns:
                # Evict all room state from memory immediately
                self.active_rooms.pop(code, None)
                self.room_presence.pop(code, None)
                logger.info(f"[WS ROOM DEALLOCATED] Room '{code}' has 0 connected clients. In-memory state and presence purged.")
                # Mark room inactive in database immediately
                await self._set_room_active_status(code, False)

    def get_online_users(self, room_code: str) -> List[Dict[str, Any]]:
        code = normalize_room_code(room_code)
        room_conns = self.active_rooms.get(code, {})
        seen_users = {}
        for s_id, data in room_conns.items():
            u_id = data["user_id"]
            if u_id not in seen_users:
                seen_users[u_id] = {
                    "user_id": u_id,
                    "username": data["username"],
                    "role": data["role"],
                    "socket_ids": [s_id]
                }
            else:
                seen_users[u_id]["socket_ids"].append(s_id)
        return list(seen_users.values())

    async def broadcast(
        self,
        room_code: str,
        message: Dict[str, Any],
        exclude_socket_id: Optional[str] = None
    ):
        code = normalize_room_code(room_code)
        room_conns = self.active_rooms.get(code, {})
        if not room_conns:
            return

        msg_type = message.get("type", "UNKNOWN")
        dead_sockets = []

        logger.debug(f"[WS BROADCAST] {msg_type} in room '{code}' to {len(room_conns)} sockets (exclude: {exclude_socket_id})")

        for socket_id, client in list(room_conns.items()):
            if exclude_socket_id and socket_id == exclude_socket_id:
                continue
            ws: WebSocket = client["ws"]
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.warning(f"[WS SEND FAILED] Socket {socket_id} in room '{code}' failed: {e}")
                dead_sockets.append(socket_id)

        for s_id in dead_sockets:
            await self.disconnect(code, s_id)

    async def handle_message(
        self,
        room_code: str,
        socket_id: str,
        data: Dict[str, Any]
    ):
        code = normalize_room_code(room_code)
        room_conns = self.active_rooms.get(code, {})
        client = room_conns.get(socket_id)
        if not client:
            return

        # Keep alive: mark current activity timestamp
        client["last_seen"] = time.time()

        if not self._check_rate_limit(socket_id):
            try:
                await client["ws"].send_json({
                    "type": "ERROR",
                    "message": "Rate limit exceeded. Slow down your update frequency."
                })
            except Exception:
                pass
            return

        try:
            msg_type = data.get("type")

            # 1. Zero-knowledge collaborative editor update (encrypted client-side)
            if msg_type in ("YJS_UPDATE", "DOC_SYNC_STEP", "ENCRYPTED_DELTA"):
                await self.broadcast(code, {
                    "type": msg_type,
                    "sender_socket_id": socket_id,
                    "document_id": data.get("document_id"),
                    "encrypted_payload": data.get("encrypted_payload"),
                    "iv": data.get("iv"),
                    "auth_tag": data.get("auth_tag"),
                    "version": data.get("version"),
                    "timestamp": time.time()
                }, exclude_socket_id=socket_id)

            # 2. Presence and Awareness (cursor positions, text selections)
            elif msg_type in ("CURSOR_UPDATE", "SELECTION_UPDATE"):
                user_id = data.get("user_id") or client.get("user_id")
                if user_id:
                    room_pres = self.room_presence.setdefault(code, {})
                    room_pres[user_id] = {
                        "user_id": user_id,
                        "socket_id": socket_id,
                        "username": data.get("username", client.get("username")),
                        "color": data.get("color"),
                        "cursor": data.get("cursor"),
                        "selection": data.get("selection"),
                        "updated_at": time.time()
                    }

                await self.broadcast(code, {
                    "type": msg_type,
                    "sender_socket_id": socket_id,
                    "user_id": user_id,
                    "username": data.get("username", client.get("username")),
                    "color": data.get("color"),
                    "cursor": data.get("cursor"),
                    "selection": data.get("selection")
                }, exclude_socket_id=socket_id)

            # 3. Heartbeat Ping / Pong
            elif msg_type == "PING":
                await client["ws"].send_json({"type": "PONG", "timestamp": time.time()})

        except Exception as e:
            logger.error(f"[WS HANDLE ERROR] Room '{code}', socket {socket_id}: {e}", exc_info=True)

    async def cleanup_stale_connections(self, max_idle_seconds: float = 60.0):
        """Watchdog routine: disconnect dead or hung sockets to free memory and empty rooms."""
        now = time.time()
        stale_list = []
        for code, conns in list(self.active_rooms.items()):
            for socket_id, client in list(conns.items()):
                last_seen = client.get("last_seen", client.get("connected_at", now))
                if now - last_seen > max_idle_seconds:
                    stale_list.append((code, socket_id, client))

        for code, socket_id, client in stale_list:
            logger.warning(f"[WS TIMEOUT] Evicting stale socket {socket_id} (user '{client.get('username')}') in room '{code}'")
            try:
                await client["ws"].close(code=1000, reason="Connection idle timeout")
            except Exception:
                pass
            await self.disconnect(code, socket_id)

        self._cleanup_stale_rate_limits()

manager = RoomConnectionManager()
