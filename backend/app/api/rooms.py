from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.session import get_db
from app.database.models import User, Room, RoomMember, AuditEvent, utcnow
from app.auth.dependencies import get_current_user, get_room_and_membership
from app.rooms.service import RoomService, normalize_room_code
from app.collaboration.manager import manager

router = APIRouter(prefix="/rooms", tags=["Rooms"])

class CreateRoomRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    threshold_required: int = Field(2, ge=1, le=10)
    threshold_total: int = Field(3, ge=1, le=10)

class JoinRoomRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=10)
    role: Optional[str] = "editor"

class UpdateRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(owner|key_holder|editor|viewer)$")

class LockRoomRequest(BaseModel):
    lock: bool
    reason: Optional[str] = "Manual administrative lock"

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_room(
    req: CreateRoomRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if req.threshold_required > req.threshold_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Threshold required cannot be greater than total key holders"
        )
    room = await RoomService.create_room(
        db=db,
        creator=user,
        name=req.name,
        threshold_required=req.threshold_required,
        threshold_total=req.threshold_total
    )
    members = await RoomService.get_room_members(db, room.id)
    return {
        "room": {
            "id": room.id,
            "code": room.code,
            "name": room.name,
            "creator_id": room.creator_id,
            "threshold_required": room.threshold_required,
            "threshold_total": room.threshold_total,
            "created_at": room.created_at.isoformat(),
            "is_active": room.is_active,
            "is_locked": room.is_locked
        },
        "id": room.id,
        "code": room.code,
        "name": room.name,
        "creator_id": room.creator_id,
        "threshold_required": room.threshold_required,
        "threshold_total": room.threshold_total,
        "created_at": room.created_at.isoformat(),
        "is_active": room.is_active,
        "is_locked": room.is_locked,
        "current_user_role": "owner",
        "members": members,
        "online_users": manager.get_online_users(room.code)
    }

@router.post("/join")
async def join_room(
    req: JoinRoomRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    code = normalize_room_code(req.code)
    room = await RoomService.get_by_code(db, code)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid room code")

    if not room.is_active:
        room.is_active = True
        await db.commit()

    try:
        member = await RoomService.join_room(db, room, user, role=req.role or "editor")
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    members = await RoomService.get_room_members(db, room.id)
    return {
        "room": {
            "id": room.id,
            "code": room.code,
            "name": room.name,
            "creator_id": room.creator_id,
            "is_active": room.is_active,
            "is_locked": room.is_locked,
            "lock_reason": room.lock_reason,
            "threshold_required": room.threshold_required,
            "threshold_total": room.threshold_total,
            "created_at": room.created_at.isoformat()
        },
        "membership": {
            "id": member.id,
            "role": member.role,
            "joined_at": member.joined_at.isoformat()
        },
        "members": members,
        "online_users": manager.get_online_users(room.code)
    }

@router.get("/{code}")
async def get_room(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if not room.is_active:
        room.is_active = True
        await db.commit()

    members = await RoomService.get_room_members(db, room.id)
    return {
        "room": {
            "id": room.id,
            "code": room.code,
            "name": room.name,
            "creator_id": room.creator_id,
            "is_active": room.is_active,
            "is_locked": room.is_locked,
            "lock_reason": room.lock_reason,
            "threshold_required": room.threshold_required,
            "threshold_total": room.threshold_total,
            "created_at": room.created_at.isoformat()
        },
        "current_user_role": member.role,
        "members": members,
        "online_users": manager.get_online_users(room.code)
    }

@router.post("/{code}/lock")
async def toggle_lock(
    code: str,
    req: LockRoomRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only room owners or key holders can modify room lockdown state"
        )

    room.is_locked = req.lock
    room.lock_reason = req.reason if req.lock else None
    
    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="ROOM_LOCKED" if req.lock else "ROOM_UNLOCKED",
        severity="critical" if req.lock else "info",
        details_json=f'{{"reason":"{req.reason}"}}'
    )
    db.add(audit)
    await db.commit()

    # Broadcast lockdown state change to all room clients
    await manager.broadcast(room.code, {
        "type": "ROOM_LOCK_STATE_CHANGED",
        "is_locked": room.is_locked,
        "lock_reason": room.lock_reason,
        "by_username": user.username
    })

    return {
        "is_locked": room.is_locked,
        "lock_reason": room.lock_reason
    }

@router.patch("/{code}/members/{target_user_id}/role")
async def update_member_role(
    code: str,
    target_user_id: str,
    req: UpdateRoleRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room owner can update member roles"
        )

    target_res = await db.execute(
        select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == target_user_id)
    )
    target_member = target_res.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    old_role = target_member.role
    target_member.role = req.role

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="ROLE_UPDATED",
        severity="warning",
        details_json=f'{{"target_user_id":"{target_user_id}","old_role":"{old_role}","new_role":"{req.role}"}}'
    )
    db.add(audit)
    await db.commit()

    await manager.broadcast(room.code, {
        "type": "MEMBER_ROLE_UPDATED",
        "user_id": target_user_id,
        "new_role": req.role
    })

    return {"status": "success", "new_role": req.role}

@router.delete("/{code}")
async def delete_room(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Host-only room deletion: permanently deletes room and all associated documents,
    records, and in-memory state. Immediately notifies all connected peers.
    """
    normalized = normalize_room_code(code)
    room = await RoomService.get_by_code(db, normalized)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Verify host authorization: creator_id == user.id or member.role == 'owner'
    is_host = room.creator_id == user.id
    if not is_host:
        member_res = await db.execute(
            select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == user.id)
        )
        member = member_res.scalar_one_or_none()
        if member and member.role == "owner":
            is_host = True

    if not is_host:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room host can delete this room"
        )

    await RoomService.delete_room(db, room)
    return {
        "status": "success",
        "room_code": normalized,
        "message": "Room and all associated records permanently deleted"
    }

@router.post("/maintenance/cleanup-expired")
async def cleanup_expired_rooms(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Safely clean up rooms that have passed their expiration timestamp.
    """
    deleted_count = await RoomService.clean_expired_rooms(db)
    return {
        "status": "success",
        "deleted_count": deleted_count
    }
