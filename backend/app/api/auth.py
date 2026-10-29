from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database.session import get_db
from app.database.models import User, Room
from app.auth.security import hash_password, verify_password, create_access_token
from app.auth.dependencies import get_current_user
from app.rooms.service import RoomService
from app.collaboration.manager import manager

router = APIRouter(prefix="/auth", tags=["Authentication"])

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="Unique account username")
    password: str = Field(..., min_length=6, description="Account password (min 6 chars)")

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="Account username")
    password: str = Field(..., min_length=1, description="Account password")

class DeleteAccountRequest(BaseModel):
    password: str = Field(..., min_length=1, description="Password confirmation for account deletion")

class UserInfo(BaseModel):
    id: str
    username: str
    role: str

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo

@router.post("/register", response_model=AuthResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    clean_username = req.username.strip()
    if len(clean_username) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 3 characters"
        )

    # Enforce case-insensitive uniqueness check
    existing = await db.execute(
        select(User).where(func.lower(User.username) == clean_username.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is already registered. Please choose another."
        )

    hashed = hash_password(req.password)
    user = User(
        username=clean_username,
        password_hash=hashed,
        role="user"
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role
        }
    }

@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    clean_username = req.username.strip()
    result = await db.execute(
        select(User).where(func.lower(User.username) == clean_username.lower())
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role
        }
    }

@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "created_at": user.created_at.isoformat()
    }

@router.delete("/account")
async def delete_account(
    req: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Permanently delete the authenticated user's account, owned rooms,
    memberships, and credentials. Requires password re-authentication.
    """
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Account deletion aborted."
        )

    user_id = user.id
    username = user.username

    # 1. Permanently delete all rooms created/owned by this user
    owned_rooms_res = await db.execute(select(Room).where(Room.creator_id == user_id))
    owned_rooms = owned_rooms_res.scalars().all()
    for room in owned_rooms:
        await RoomService.delete_room(db, room)

    # 2. Clean up any remaining authored/referenced records in other rooms
    from sqlalchemy import delete
    from app.database.models import (
        ExportRecord, AuditEvent, SourceItem, VaultSecret,
        ThresholdApproval, RoomMember
    )

    await db.execute(delete(ExportRecord).where(ExportRecord.user_id == user_id))
    await db.execute(delete(AuditEvent).where(AuditEvent.user_id == user_id))
    await db.execute(delete(SourceItem).where(SourceItem.created_by == user_id))
    await db.execute(delete(VaultSecret).where(VaultSecret.created_by == user_id))
    await db.execute(delete(ThresholdApproval).where(ThresholdApproval.requested_by == user_id))
    await db.execute(delete(RoomMember).where(RoomMember.user_id == user_id))

    # 3. Disconnect any active WebSocket connections for this user
    await manager.disconnect_user(user_id, reason="Account has been permanently deleted")

    # 4. Delete the User account record
    await db.delete(user)
    await db.commit()

    return {
        "status": "success",
        "username": username,
        "message": "Account and all associated resources permanently deleted"
    }
