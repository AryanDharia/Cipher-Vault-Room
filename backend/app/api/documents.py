import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update, delete as sql_delete, func
from sqlalchemy.exc import IntegrityError

from app.database.session import get_db
from app.database.models import User, Room, RoomMember, Document, DocumentUpdate, AuditEvent, ExportRecord, utcnow
from app.auth.dependencies import get_current_user, get_room_and_membership
from app.collaboration.manager import manager

router = APIRouter(prefix="/rooms/{code}/documents", tags=["Documents"])

class CreateDocumentRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    doc_type: str = Field("document", pattern="^(document|code)$")
    language: Optional[str] = "markdown"
    is_protected: bool = False
    encrypted_envelope: Optional[str] = None

class UpdateDocumentRequest(BaseModel):
    title: Optional[str] = None
    language: Optional[str] = None
    encrypted_envelope: Optional[str] = None
    is_protected: Optional[bool] = None

class CollaborationUpdateRequest(BaseModel):
    update_id: str = Field(..., min_length=36, max_length=36)
    encrypted_payload: str = Field(..., min_length=1, max_length=4_000_000)

class CollaborationInitializeRequest(CollaborationUpdateRequest):
    pass

class ExportDocumentRequest(BaseModel):
    format: str = Field("markdown", pattern="^(markdown|txt|pdf)$")

@router.get("")
async def list_documents(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(Document).where(Document.room_id == room.id).order_by(Document.created_at.asc())
    )
    docs = result.scalars().all()
    return [
        {
            "id": d.id,
            "title": d.title,
            "doc_type": d.doc_type,
            "language": d.language,
            "is_protected": d.is_protected,
            "version": d.version,
            "has_content": bool(d.encrypted_envelope),
            "encrypted_envelope": d.encrypted_envelope,
            "created_at": d.created_at.isoformat(),
            "updated_at": d.updated_at.isoformat()
        }
        for d in docs
    ]

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_document(
    code: str,
    req: CreateDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot create documents")
    if room.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Room is currently locked")

    doc = Document(
        room_id=room.id,
        title=req.title,
        doc_type=req.doc_type,
        language=req.language or "markdown",
        is_protected=req.is_protected,
        encrypted_envelope=req.encrypted_envelope,
        version=1
    )
    db.add(doc)
    await db.flush()

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="DOCUMENT_CREATED",
        severity="info",
        details_json=f'{{"doc_id":"{doc.id}","title":"{doc.title}","is_protected":{str(doc.is_protected).lower()}}}'
    )
    db.add(audit)
    await db.commit()
    await db.refresh(doc)

    await manager.broadcast(room.code, {
        "type": "DOCUMENT_CREATED",
        "doc_id": doc.id,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "is_protected": doc.is_protected,
        "encrypted_envelope": doc.encrypted_envelope,
        "version": doc.version,
        "created_by": user.username
    })

    return {
        "id": doc.id,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "is_protected": doc.is_protected,
        "encrypted_envelope": doc.encrypted_envelope,
        "has_content": bool(doc.encrypted_envelope),
        "version": doc.version
    }

@router.get("/{doc_id}")
async def get_document(
    code: str,
    doc_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.room_id == room.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return {
        "id": doc.id,
        "room_id": doc.room_id,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "is_protected": doc.is_protected,
        "encrypted_envelope": doc.encrypted_envelope,
        "version": doc.version,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat()
    }

@router.get("/{doc_id}/collaboration-updates")
async def list_collaboration_updates(
    code: str,
    doc_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.room_id == room.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    updates_result = await db.execute(
        select(DocumentUpdate)
        .where(DocumentUpdate.room_id == room.id, DocumentUpdate.document_id == doc.id)
        .order_by(DocumentUpdate.is_initial.desc(), DocumentUpdate.created_at.asc(), DocumentUpdate.id.asc())
        .limit(10000)
    )
    updates = updates_result.scalars().all()
    # Never return a truncated CRDT log: applying only part of it could silently
    # construct an incomplete document. Require repair/compaction instead.
    count_result = await db.execute(
        select(func.count(DocumentUpdate.id)).where(
            DocumentUpdate.room_id == room.id, DocumentUpdate.document_id == doc.id
        )
    )
    if (count_result.scalar() or 0) > len(updates):
        raise HTTPException(status_code=413, detail="Collaboration history is too large to restore safely")
    return {
        "initialized": bool(doc.collaboration_initialized),
        "updates": [{"update_id": item.id, "encrypted_payload": item.encrypted_payload} for item in updates],
    }

@router.post("/{doc_id}/collaboration-initialize")
async def initialize_collaboration(
    code: str,
    doc_id: str,
    req: CollaborationInitializeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role == "viewer" or room.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editing is not permitted")
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.room_id == room.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    claim = await db.execute(
        sql_update(Document)
        .where(Document.id == doc.id, Document.room_id == room.id, Document.collaboration_initialized == False)
        .values(collaboration_initialized=True)
    )
    if claim.rowcount != 1:
        await db.rollback()
        return {"initialized": False}

    db.add(DocumentUpdate(
        id=req.update_id,
        room_id=room.id,
        document_id=doc.id,
        encrypted_payload=req.encrypted_payload,
        is_initial=True,
    ))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Collaboration initialization conflicted; reload the document")
    return {"initialized": True}

@router.put("/{doc_id}")
async def update_document(
    code: str,
    doc_id: str,
    req: UpdateDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot edit documents")
    if room.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Room is currently locked")

    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.room_id == room.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if req.title is not None:
        doc.title = req.title
    if req.language is not None:
        doc.language = req.language
    if req.encrypted_envelope is not None:
        doc.encrypted_envelope = req.encrypted_envelope
        doc.version += 1
    if req.is_protected is not None and member.role in ("owner", "key_holder"):
        doc.is_protected = req.is_protected

    doc.updated_at = utcnow()
    await db.commit()

    # Broadcast document change so other participants' document lists and states update
    await manager.broadcast(room.code, {
        "type": "DOCUMENT_UPDATED",
        "doc_id": doc.id,
        "title": doc.title,
        "version": doc.version,
        "encrypted_envelope": doc.encrypted_envelope,
        "updated_at": doc.updated_at.isoformat()
    })

    return {
        "id": doc.id,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "is_protected": doc.is_protected,
        "encrypted_envelope": doc.encrypted_envelope,
        "has_content": bool(doc.encrypted_envelope),
        "version": doc.version,
        "updated_at": doc.updated_at.isoformat()
    }

@router.delete("/{doc_id}")
async def delete_document(
    code: str,
    doc_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners or key holders can delete documents")

    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.room_id == room.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    await db.execute(
        sql_delete(DocumentUpdate).where(
            DocumentUpdate.room_id == room.id,
            DocumentUpdate.document_id == doc.id,
        )
    )
    await db.delete(doc)
    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="DOCUMENT_DELETED",
        severity="warning",
        details_json=f'{{"doc_id":"{doc_id}","title":"{doc.title}"}}'
    )
    db.add(audit)
    await db.commit()

    await manager.broadcast(room.code, {
        "type": "DOCUMENT_DELETED",
        "doc_id": doc_id,
        "deleted_by": user.username
    })

    return {"status": "deleted", "doc_id": doc_id}

@router.post("/{doc_id}/export")
async def export_document(
    code: str,
    doc_id: str,
    req: ExportDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if room.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Exporting is disabled while room is in lockdown")

    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.room_id == room.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Generate cryptographic tracking token for forensic watermarking
    export_token = f"VR-EXP-{secrets.token_hex(8).upper()}"
    watermark = f"CONFIDENTIAL // VAULTROOM [{room.code}] // EXPORT ID: {export_token} // USER: {user.username} [{user.id[:8]}] // {utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}"

    record = ExportRecord(
        export_id=export_token,
        room_id=room.id,
        document_id=doc.id,
        user_id=user.id,
        user_name=user.username,
        watermark_text=watermark
    )
    db.add(record)

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="DOCUMENT_EXPORTED",
        severity="info",
        details_json=f'{{"doc_id":"{doc.id}","export_id":"{export_token}","format":"{req.format}"}}'
    )
    db.add(audit)
    await db.commit()

    return {
        "export_id": export_token,
        "watermark": watermark,
        "format": req.format,
        "exported_at": utcnow().isoformat()
    }
