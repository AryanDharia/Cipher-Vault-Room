import asyncio
import json
import time
import logging
from typing import Dict, List, Set, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect
from app.rooms.service import normalize_room_code

logger = logging.getLogger("vaultroom.collaboration")
logging.basicConfig(level=logging.INFO)

class RoomConnectionManager:
    """
    Manages active WebSocket connections per room.
    Ensures zero-knowledge update relaying (payloads remain encrypted client-side)
    while managing presence, rate limits, and audit notifications.
    """
    def __init__(self):
        # room_code -> Dict[socket_id, { "ws": WebSocket, "user_id": str, "username": str, "role": str, "connected_at": float }]
        self.active_rooms: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # socket_id -> { "count": int, "window_start": float }
        self.rate_limits: Dict[str, Dict[str, Any]] = {}
        self.max_messages_per_second = 100

    def _check_rate_limit(self, socket_id: str) -> bool:
        now = time.time()
        record = self.rate_limits.setdefault(socket_id, {"count": 0, "window_start": now})
        if now - record["window_start"] > 1.0:
            record["count"] = 0
            record["window_start"] = now
        record["count"] += 1
        return record["count"] <= self.max_messages_per_second

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
        room_conns = self.active_rooms.setdefault(code, {})
        room_conns[socket_id] = {
            "ws": websocket,
            "user_id": user_id,
            "username": username,
            "role": role,
            "connected_at": time.time()
        }

        logger.info(f"[WS CONNECT] User '{username}' ({user_id}) joined room '{code}' on socket {socket_id}. Total in room: {len(room_conns)}")

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
                "online_users": self.get_online_users(code)
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
                logger.info(f"[WS DISCONNECT] User '{user_info.get('username')}' disconnected from room '{code}' (socket {socket_id}). Remaining: {len(room_conns)}")
                # Broadcast participant leave
                await self.broadcast(code, {
                    "type": "USER_LEFT",
                    "socket_id": socket_id,
                    "user_id": user_info["user_id"],
                    "username": user_info["username"],
                    "online_users": self.get_online_users(code)
                })

            if not room_conns:
                self.active_rooms.pop(code, None)
                logger.info(f"[WS ROOM CLOSED] Room '{code}' has 0 connected clients and is now inactive in memory.")

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
        if not self._check_rate_limit(socket_id):
            room_conns = self.active_rooms.get(code, {})
            client = room_conns.get(socket_id)
            if client:
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
                # Relay encrypted payload blindly to all other room participants
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
                await self.broadcast(code, {
                    "type": msg_type,
                    "sender_socket_id": socket_id,
                    "user_id": data.get("user_id"),
                    "username": data.get("username"),
                    "color": data.get("color"),
                    "cursor": data.get("cursor"),
                    "selection": data.get("selection")
                }, exclude_socket_id=socket_id)

            # 3. Heartbeat Ping
            elif msg_type == "PING":
                room_conns = self.active_rooms.get(code, {})
                client = room_conns.get(socket_id)
                if client:
                    await client["ws"].send_json({"type": "PONG", "timestamp": time.time()})

        except Exception as e:
            logger.error(f"[WS HANDLE ERROR] Room '{code}', socket {socket_id}: {e}", exc_info=True)

manager = RoomConnectionManager()
