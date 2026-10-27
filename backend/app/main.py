import os
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database.session import init_db, AsyncSessionLocal
from app.database.models import Room, RoomMember, User
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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schemas
    await init_db()
    yield

app = FastAPI(
    title="VaultRoom Secure Workspace API",
    description="Encrypted Collaborative Document Workspace, Key Vault & Security Lab",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + ["*"],
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
async def websocket_endpoint(
    websocket: WebSocket,
    room_code: str,
    token: str = Query(...)
):
    code = normalize_room_code(room_code)
    
    # 1. Validate JWT Token
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired authentication token")
        return

    user_id = payload["sub"]
    username = payload.get("username", "Unknown")

    # 2. Validate Room & Membership
    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == code))
        room = room_res.scalar_one_or_none()
        if not room:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Room does not exist")
            return

        member_res = await db.execute(
            select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == user_id)
        )
        member = member_res.scalar_one_or_none()
        if not member:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Not an authorized room member")
            return

        role = member.role

    socket_id = str(uuid.uuid4())[:8]

    # 3. Connect to Manager
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
        await manager.disconnect(code, socket_id)
    except Exception:
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
