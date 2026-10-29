from typing import Optional
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.session import get_db
from app.database.models import User, Room, RoomMember
from app.auth.security import decode_access_token

security_scheme = HTTPBearer(auto_error=False)

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials required",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    payload = decode_access_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    user_id = payload["sub"]
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return user

async def get_room_and_membership(
    code: str,
    user: User,
    db: AsyncSession
) -> tuple[Room, RoomMember]:
    """Verify room exists and user is an authorized member."""
    from sqlalchemy import func
    from app.rooms.service import normalize_room_code
    normalized = normalize_room_code(code)
    
    room_result = await db.execute(select(Room).where(func.upper(Room.code) == normalized))
    room = room_result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    
    member_result = await db.execute(
        select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == user.id)
    )
    member = member_result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this room. Please join using the room code."
        )
    
    if getattr(member, "is_kicked", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access revoked: you have been removed from this room by the host."
        )

    # Ensure room creator is always recognized as room owner
    if user.id == room.creator_id and member.role != "owner":
        member.role = "owner"
    
    return room, member
