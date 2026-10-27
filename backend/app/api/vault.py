from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.session import get_db
from app.database.models import User, Room, RoomMember, VaultSecret, AuditEvent, utcnow
from app.auth.dependencies import get_current_user, get_room_and_membership
from app.collaboration.manager import manager

router = APIRouter(prefix="/rooms/{code}/vault", tags=["Key Locker"])

class AddSecretRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    category: str = Field("api_key", pattern="^(api_key|database|token|password|config)$")
    encrypted_value: str = Field(..., min_length=10)
    iv: str = Field(..., min_length=12)
    auth_tag: Optional[str] = None
    description: Optional[str] = ""

class RotateSecretRequest(BaseModel):
    encrypted_value: str = Field(..., min_length=10)
    iv: str = Field(..., min_length=12)
    auth_tag: Optional[str] = None

@router.get("")
async def list_secrets(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(VaultSecret).where(VaultSecret.room_id == room.id).order_by(VaultSecret.created_at.desc())
    )
    secrets_list = result.scalars().all()
    # Masked representation - NEVER return plaintext secret
    return [
        {
            "id": s.id,
            "name": s.name,
            "category": s.category,
            "description": s.description,
            "masked_preview": "••••••••••••••••",
            "created_at": s.created_at.isoformat(),
            "last_rotated_at": s.last_rotated_at.isoformat()
        }
        for s in secrets_list
    ]

@router.post("", status_code=status.HTTP_201_CREATED)
async def add_secret(
    code: str,
    req: AddSecretRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder", "editor"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permission to add secrets")
    if room.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Room is currently locked")

    secret = VaultSecret(
        room_id=room.id,
        name=req.name,
        category=req.category,
        encrypted_value=req.encrypted_value,
        iv=req.iv,
        auth_tag=req.auth_tag,
        description=req.description or "",
        created_by=user.id,
        created_at=utcnow(),
        last_rotated_at=utcnow()
    )
    db.add(secret)
    await db.flush()

    # Redacted audit logging - NEVER log secret ciphertext or keys
    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SECRET_STORED",
        severity="info",
        details_json=f'{{"secret_id":"{secret.id}","name":"{secret.name}","category":"{secret.category}"}}'
    )
    db.add(audit)
    await db.commit()
    await db.refresh(secret)

    await manager.broadcast(room.code, {
        "type": "SECRET_ADDED",
        "secret_id": secret.id,
        "name": secret.name,
        "category": secret.category
    })

    return {
        "id": secret.id,
        "name": secret.name,
        "category": secret.category,
        "masked_preview": "••••••••••••••••",
        "created_at": secret.created_at.isoformat()
    }

@router.get("/{secret_id}/reveal")
async def reveal_secret(
    code: str,
    secret_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Room Owners or designated Key Holders can decrypt vault secrets"
        )
    if room.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Secret access disabled while room is in lockdown")

    result = await db.execute(
        select(VaultSecret).where(VaultSecret.id == secret_id, VaultSecret.room_id == room.id)
    )
    secret = result.scalar_one_or_none()
    if not secret:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")

    # Record security-audited access
    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SECRET_ACCESSED",
        severity="warning",
        details_json=f'{{"secret_id":"{secret.id}","name":"{secret.name}"}}'
    )
    db.add(audit)
    await db.commit()

    return {
        "id": secret.id,
        "name": secret.name,
        "category": secret.category,
        "encrypted_value": secret.encrypted_value,
        "iv": secret.iv,
        "auth_tag": secret.auth_tag
    }

@router.put("/{secret_id}/rotate")
async def rotate_secret(
    code: str,
    secret_id: str,
    req: RotateSecretRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permission to rotate secrets")

    result = await db.execute(
        select(VaultSecret).where(VaultSecret.id == secret_id, VaultSecret.room_id == room.id)
    )
    secret = result.scalar_one_or_none()
    if not secret:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")

    secret.encrypted_value = req.encrypted_value
    secret.iv = req.iv
    secret.auth_tag = req.auth_tag
    secret.last_rotated_at = utcnow()

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SECRET_ROTATED",
        severity="info",
        details_json=f'{{"secret_id":"{secret.id}","name":"{secret.name}"}}'
    )
    db.add(audit)
    await db.commit()

    return {"status": "rotated", "id": secret.id, "last_rotated_at": secret.last_rotated_at.isoformat()}

@router.delete("/{secret_id}")
async def delete_secret(
    code: str,
    secret_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners or key holders can delete secrets")

    result = await db.execute(
        select(VaultSecret).where(VaultSecret.id == secret_id, VaultSecret.room_id == room.id)
    )
    secret = result.scalar_one_or_none()
    if not secret:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")

    await db.delete(secret)
    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SECRET_DELETED",
        severity="warning",
        details_json=f'{{"secret_id":"{secret_id}","name":"{secret.name}"}}'
    )
    db.add(audit)
    await db.commit()

    return {"status": "deleted", "id": secret_id}
