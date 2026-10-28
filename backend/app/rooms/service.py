import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import Room, RoomMember, User, AuditEvent, utcnow
from app.config import settings

# Unambiguous alphabet omitting similar chars like 0, O, 1, I
ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_CODE_RETRIES = 50

def generate_random_room_code() -> str:
    """Generate a cryptographically secure 6-character room code."""
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(6))

def normalize_room_code(code: str) -> str:
    """Sanitize and format room code."""
    if not code:
        return ""
    return "".join(c for c in code.strip().upper() if c in ROOM_CODE_ALPHABET)

class RoomService:
    @staticmethod
    async def create_room(
        db: AsyncSession,
        creator: User,
        name: str,
        threshold_required: int = 2,
        threshold_total: int = 3
    ) -> Room:
        # Generate unique room code with retries
        code = None
        for _ in range(MAX_CODE_RETRIES):
            candidate = generate_random_room_code()
            result = await db.execute(select(Room).where(Room.code == candidate))
            if not result.scalar_one_or_none():
                code = candidate
                break
        
        if not code:
            raise RuntimeError("FAILED_TO_ALLOCATE_ROOM_CODE")

        now = utcnow()
        expires_at = now + timedelta(hours=settings.ROOM_CODE_EXPIRY_HOURS)

        room = Room(
            code=code,
            name=name.strip() or f"Vault-{code}",
            creator_id=creator.id,
            created_at=now,
            expires_at=expires_at,
            is_locked=False,
            threshold_required=threshold_required,
            threshold_total=threshold_total
        )
        db.add(room)
        await db.flush()

        # Add creator as owner and initial key holder
        owner_member = RoomMember(
            room_id=room.id,
            user_id=creator.id,
            role="owner",
            joined_at=now,
            last_seen_at=now
        )
        db.add(owner_member)

        # Audit event for room creation
        audit = AuditEvent(
            room_id=room.id,
            user_id=creator.id,
            username=creator.username,
            event_type="ROOM_CREATED",
            severity="info",
            details_json=f'{{"code":"{code}","name":"{room.name}"}}'
        )
        db.add(audit)
        await db.commit()
        await db.refresh(room)
        return room

    @staticmethod
    async def get_by_code(db: AsyncSession, code: str) -> Optional[Room]:
        normalized = normalize_room_code(code)
        if not normalized:
            return None
        result = await db.execute(select(Room).where(func.upper(Room.code) == normalized))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_id(db: AsyncSession, room_id: str) -> Optional[Room]:
        result = await db.execute(select(Room).where(Room.id == room_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def join_room(
        db: AsyncSession,
        room: Room,
        user: User,
        role: str = "editor"
    ) -> RoomMember:
        if room.is_locked:
            raise PermissionError(f"Room is locked: {room.lock_reason or 'Security lockdown active'}")

        # Check existing membership
        result = await db.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id,
                RoomMember.user_id == user.id
            )
        )
        member = result.scalar_one_or_none()

        now = utcnow()
        if member:
            member.last_seen_at = now
        else:
            # Check room capacity
            members_result = await db.execute(
                select(RoomMember).where(RoomMember.room_id == room.id)
            )
            count = len(members_result.scalars().all())
            if count >= settings.ROOM_MAX_PARTICIPANTS:
                raise ValueError("Room has reached maximum capacity")

            # Default roles: if creator joins, owner; else role passed (editor/viewer/key_holder)
            actual_role = "owner" if user.id == room.creator_id else role
            member = RoomMember(
                room_id=room.id,
                user_id=user.id,
                role=actual_role,
                joined_at=now,
                last_seen_at=now
            )
            db.add(member)

            # Audit join
            audit = AuditEvent(
                room_id=room.id,
                user_id=user.id,
                username=user.username,
                event_type="MEMBER_JOINED",
                severity="info",
                details_json=f'{{"role":"{actual_role}"}}'
            )
            db.add(audit)

        await db.commit()
        await db.refresh(member)
        return member

    @staticmethod
    async def get_room_members(db: AsyncSession, room_id: str) -> List[Dict]:
        result = await db.execute(
            select(RoomMember, User)
            .join(User, RoomMember.user_id == User.id)
            .where(RoomMember.room_id == room_id)
        )
        members_data = []
        for member, user in result.all():
            members_data.append({
                "id": member.id,
                "user_id": user.id,
                "username": user.username,
                "role": member.role,
                "joined_at": member.joined_at.isoformat(),
                "last_seen_at": member.last_seen_at.isoformat()
            })
        return members_data
