import os
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.config import settings
from app.database.session import init_db, AsyncSessionLocal
from app.database.models import Room, RoomMember, User, utcnow
from app.auth.security import decode_access_token
from app.rooms.service import normalize_room_code
from app.collaboration.manager import manager

from app.api.auth import router as auth_router
from app.api.rooms import router as rooms_router
from app.api.documents import router as documents_router
from app.api.approvals import router as approvals_router
from app.api.vault import router as vault_router
from app.api.sources import router as sources_router
from app.api.security import router as security_router

import asyncio
import logging
logger = logging.getLogger("vaultroom.main")

async def connection_watchdog():
    while True:
        try:
            await asyncio.sleep(20)
            await manager.cleanup_stale_connections(max_idle_seconds=60.0)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[WATCHDOG ERROR] {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schemas
    await init_db()
    watchdog = asyncio.create_task(connection_watchdog())
    yield
    watchdog.cancel()
    try:
        await watchdog
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="VaultRoom Secure Workspace API",
    description="Encrypted Collaborative Document Workspace, Key Vault & Security Lab",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration: Allow credentials while properly matching origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API routers
app.include_router(auth_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(approvals_router, prefix="/api")
app.include_router(vault_router, prefix="/api")
app.include_router(sources_router, prefix="/api")
app.include_router(security_router, prefix="/api")

@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "vaultroom-backend",
        "environment": settings.ENVIRONMENT,
        "active_rooms": len(manager.active_rooms),
        "zero_knowledge_enforced": True
    }

@app.websocket("/ws/{room_code}")
@app.websocket("/ws/{room_code}/")
async def websocket_endpoint(
    websocket: WebSocket,
    room_code: str,
    token: str = Query(...)
):
    # 1. Accept WebSocket connection immediately so reverse proxies complete handshake
    await websocket.accept()

    code = normalize_room_code(room_code)
    logger.info(f"[WS ATTEMPT] Inbound connection for room '{code}'")
    
    # 2. Validate JWT Token
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        logger.warning(f"[WS AUTH FAIL] Invalid or expired token for room '{code}'")
        try:
            await websocket.send_json({"type": "ERROR", "message": "Invalid or expired authentication token"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")
        except Exception:
            pass
        return

    user_id = payload["sub"]
    username = payload.get("username", "Unknown")

    # 3. Validate Room & Membership
    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(func.upper(Room.code) == code))
        room = room_res.scalar_one_or_none()
        if not room:
            logger.warning(f"[WS ROOM NOT FOUND] Room '{code}' does not exist (user: {username})")
            try:
                await websocket.send_json({"type": "ERROR", "message": "Room does not exist"})
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Room does not exist")
            except Exception:
                pass
            return

        if not room.is_active:
            room.is_active = True
            await db.commit()
            logger.info(f"[WS REACTIVATE] Inactive room '{code}' reactivated by websocket connection.")

        member_res = await db.execute(
            select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == user_id)
        )
        member = member_res.scalar_one_or_none()
        if not member:
            if room.is_locked:
                logger.warning(f"[WS ROOM LOCKED] Room '{code}' is locked. User {username} cannot join.")
                try:
                    await websocket.send_json({"type": "ERROR", "message": "Room is locked"})
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Room is locked")
                except Exception:
                    pass
                return

            # Ensure valid room participant is recorded
            member = RoomMember(
                room_id=room.id,
                user_id=user_id,
                role="editor",
                joined_at=utcnow(),
                last_seen_at=utcnow()
            )
            db.add(member)
            await db.commit()
            await db.refresh(member)
            logger.info(f"[WS AUTO-JOIN] User '{username}' ({user_id}) joined room '{code}' as editor")

        role = member.role

    socket_id = str(uuid.uuid4())[:8]

    # 4. Connect to Manager
    await manager.connect(
        websocket=websocket,
        room_code=code,
        socket_id=socket_id,
        user_id=user_id,
        username=username,
        role=role
    )

    try:
        while True:
            data = await websocket.receive_json()
            await manager.handle_message(code, socket_id, data)
    except WebSocketDisconnect:
        logger.info(f"[WS DISCONNECT] Socket {socket_id} disconnected from room '{code}'")
        await manager.disconnect(code, socket_id)
    except Exception as e:
        logger.warning(f"[WS LOOP EXIT] Socket {socket_id} in room '{code}' exited: {e}")
        await manager.disconnect(code, socket_id)

# -------------------------------------------------------------
# Single-Service SPA Frontend Serving
# Serves the built React / TipTap frontend from FastAPI
# -------------------------------------------------------------
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa_frontend(full_path: str):
        # Allow API routes to be handled by routers
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return status.HTTP_404_NOT_FOUND
        
        target_file = FRONTEND_DIST / full_path
        if full_path and target_file.is_file():
            return FileResponse(target_file)
        
        index_html = FRONTEND_DIST / "index.html"
        if index_html.is_file():
            return FileResponse(index_html)
        
        return {"error": "Frontend build files not found. Run npm run build in frontend directory."}
