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
    num_hosts: Optional[int] = Field(None, ge=1, le=20)
    max_members: Optional[int] = Field(20, ge=2, le=100)
    threshold_required: Optional[int] = Field(None, ge=1, le=20)
    threshold_total: Optional[int] = Field(None, ge=1, le=20)

class JoinRoomRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=10)
    role: Optional[str] = "editor"

class UpdateRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(owner|co_host|cohost|key_holder|editor|viewer)$")

class KickMemberRequest(BaseModel):
    reason: Optional[str] = "Removed from room by administrator"

class UpdateRoomSettingsRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    max_members: Optional[int] = Field(None, ge=2, le=100)

class LockRoomRequest(BaseModel):
    lock: bool
    reason: Optional[str] = "Manual administrative lock"

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_room(
    req: CreateRoomRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Determine threshold configuration from simplified or advanced settings
    max_mem = req.max_members or 20

    if req.threshold_required is not None and req.threshold_total is not None:
        th_req = req.threshold_required
        th_tot = req.threshold_total
    elif req.num_hosts is not None:
        # Map number of hosts to quorum policy safely
        if req.num_hosts == 1:
            th_req = 1
            th_tot = 1
        else:
            th_req = req.num_hosts
            th_tot = req.num_hosts
    else:
        # Sensible backward-compatible default (2-of-3)
        th_req = 2
        th_tot = 3

    if th_req > th_tot:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quorum threshold cannot be greater than total key holders / hosts"
        )
    if th_tot > max_mem:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Total key holders ({th_tot}) cannot exceed total room members allowed ({max_mem})"
        )

    room = await RoomService.create_room(
        db=db,
        creator=user,
        name=req.name,
        threshold_required=th_req,
        threshold_total=th_tot,
        max_members=max_mem
    )
    members = await RoomService.get_room_members(db, room.id)
    return {
        "room": {
            "id": room.id,
            "code": room.code,
            "name": room.name,
            "creator_id": room.creator_id,
            "max_members": room.max_members,
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
        "max_members": room.max_members,
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
            "max_members": room.max_members,
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
            "max_members": room.max_members,
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
    
    # 1. Prevent self-promotion or self-demotion
    if target_user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot modify your own role"
        )

    # 2. Only the original host can promote or demote co-hosts, key holders, editors, or viewers
    is_host = (room.creator_id == user.id) or (member.role == "owner")
    if not is_host:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room host can update member roles"
        )

    target_res = await db.execute(
        select(RoomMember, User.username)
        .join(User, RoomMember.user_id == User.id)
        .where(RoomMember.room_id == room.id, RoomMember.user_id == target_user_id, RoomMember.is_kicked == False)
    )
    target_row = target_res.first()
    if not target_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found in room")

    target_member, target_username = target_row
    old_role = target_member.role
    normalized_role = "co_host" if req.role in ("co_host", "cohost") else req.role

    # If promoting to owner, transfer ownership
    if normalized_role == "owner":
        room.creator_id = target_user_id
        target_member.role = "owner"
        member.role = "co_host"
    else:
        target_member.role = normalized_role

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="ROLE_UPDATED",
        severity="warning",
        details_json=f'{{"target_user_id":"{target_user_id}","target_username":"{target_username}","old_role":"{old_role}","new_role":"{target_member.role}"}}'
    )
    db.add(audit)
    await db.commit()

    await manager.broadcast(room.code, {
        "type": "MEMBER_ROLE_UPDATED",
        "user_id": target_user_id,
        "username": target_username,
        "old_role": old_role,
        "new_role": target_member.role,
        "by_username": user.username
    })

    return {"status": "success", "new_role": target_member.role, "username": target_username}

@router.post("/{code}/members/{target_user_id}/kick")
@router.delete("/{code}/members/{target_user_id}")
async def kick_member(
    code: str,
    target_user_id: str,
    req: Optional[KickMemberRequest] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a member from the room:
    - Allowed for room host and authorized co-hosts.
    - Protects the host from being kicked by anyone.
    - Prevents co-hosts from kicking other co-hosts.
    - Immediately revokes room access and disconnects all active sockets.
    - Ensures the kicked member cannot rejoin using stale session or WebSocket.
    """
    room, member = await get_room_and_membership(code, user, db)

    is_host = (room.creator_id == user.id) or (member.role == "owner")
    is_co_host = (member.role == "co_host")

    if not (is_host or is_co_host):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room host and co-hosts can remove members from the room"
        )

    if target_user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove yourself from the room"
        )

    if target_user_id == room.creator_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The room host cannot be removed from the room"
        )

    target_res = await db.execute(
        select(RoomMember, User.username)
        .join(User, RoomMember.user_id == User.id)
        .where(RoomMember.room_id == room.id, RoomMember.user_id == target_user_id, RoomMember.is_kicked == False)
    )
    target_row = target_res.first()
    if not target_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active member not found in this room")

    target_member, target_username = target_row

    if target_member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The room host cannot be removed from the room"
        )

    if is_co_host and target_member.role == "co_host":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Co-hosts cannot remove other co-hosts. Only the room host can do this."
        )

    reason = req.reason if (req and req.reason) else "Removed from room by administrator"

    # Mark member as kicked in database
    target_member.is_kicked = True

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="MEMBER_KICKED",
        severity="warning",
        details_json=f'{{"target_user_id":"{target_user_id}","target_username":"{target_username}","by":"{user.username}","reason":"{reason}"}}'
    )
    db.add(audit)
    await db.commit()

    # Disconnect target immediately from WebSocket and notify remaining peers
    await manager.kick_user_from_room(room.code, target_user_id, reason=reason, by_username=user.username)

    return {
        "status": "success",
        "room_code": room.code,
        "kicked_user_id": target_user_id,
        "kicked_username": target_username,
        "message": f"{target_username} has been removed from the room"
    }

@router.post("/{code}/members/{target_user_id}/unban")
async def unban_member(
    code: str,
    target_user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Allow a previously kicked member to rejoin the room.
    """
    room, member = await get_room_and_membership(code, user, db)
    is_host = (room.creator_id == user.id) or (member.role == "owner")
    if not (is_host or member.role == "co_host"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hosts and co-hosts can re-authorize members"
        )

    target_res = await db.execute(
        select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == target_user_id)
    )
    target_member = target_res.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member record not found")

    target_member.is_kicked = False
    await db.commit()
    return {"status": "success", "message": "Member re-authorized to join room"}

@router.patch("/{code}/settings")
async def update_room_settings(
    code: str,
    req: UpdateRoomSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update room capacity (max_members) or room name.
    Allowed for room host and co-hosts.
    """
    room, member = await get_room_and_membership(code, user, db)
    is_host = (room.creator_id == user.id) or (member.role == "owner")
    if not (is_host or member.role == "co_host"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hosts and co-hosts can update room settings"
        )

    if req.max_members is not None:
        if req.max_members < room.threshold_total:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Room capacity ({req.max_members}) cannot be less than total key holders ({room.threshold_total})"
            )
        room.max_members = req.max_members

    if req.name is not None and req.name.strip():
        room.name = req.name.strip()

    await db.commit()
    await db.refresh(room)

    await manager.broadcast(room.code, {
        "type": "ROOM_SETTINGS_UPDATED",
        "room_code": room.code,
        "name": room.name,
        "max_members": room.max_members,
        "by_username": user.username
    })

    return {
        "status": "success",
        "name": room.name,
        "max_members": room.max_members
    }

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
