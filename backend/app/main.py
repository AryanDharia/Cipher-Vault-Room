import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware
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
