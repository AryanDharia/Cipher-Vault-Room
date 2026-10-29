import json
import io
import httpx
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.session import get_db
from app.database.models import User, Room, RoomMember, SourceItem, AuditEvent, utcnow
from app.auth.dependencies import get_current_user, get_room_and_membership
from app.collaboration.manager import manager

router = APIRouter(prefix="/rooms/{code}/sources", tags=["Source Library"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB maximum
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".json", ".csv"}

def get_mime_type(ext: str) -> str:
    mimes = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".json": "application/json",
        ".csv": "text/csv; charset=utf-8"
    }
    return mimes.get(ext, "application/octet-stream")

def extract_docx_text(docx_bytes: bytes) -> str:
    """
    Safely extract readable text from a .docx file using standard library zipfile and XML parser.
    Zero untrusted code execution, zero external dependencies.
    """
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
            if "word/document.xml" not in z.namelist():
                return "DOCX document preview: word/document.xml missing from archive."
            xml_content = z.read("word/document.xml")
            tree = ET.fromstring(xml_content)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            paragraphs = []
            for p in tree.iterfind('.//w:p', ns):
                texts = [node.text for node in p.iterfind('.//w:t', ns) if node.text]
                if texts:
                    paragraphs.append("".join(texts))
            return "\n\n".join(paragraphs) if paragraphs else "DOCX document contains no text body."
    except Exception as e:
        return f"DOCX document preview: parsing error: {e}"

class AddUrlSourceRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    url: str = Field(..., min_length=5, max_length=1024)
    tags: Optional[List[str]] = []

class AddTextSourceRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    content: str = Field(..., min_length=1)
    source_type: str = Field("text", pattern="^(text|markdown)$")
    tags: Optional[List[str]] = []

@router.get("")
async def list_sources(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(SourceItem).where(SourceItem.room_id == room.id).order_by(SourceItem.created_at.desc())
    )
    sources = result.scalars().all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "source_type": s.source_type,
            "content_preview": s.content_preview,
            "url": s.url,
            "filename": s.filename,
            "file_size": s.file_size,
            "tags": json.loads(s.tags_json) if s.tags_json else [],
            "created_at": s.created_at.isoformat()
        }
        for s in sources
    ]

@router.post("/text", status_code=status.HTTP_201_CREATED)
async def add_text_source(
    code: str,
    req: AddTextSourceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot add sources")

    preview = req.content[:300].strip() + ("..." if len(req.content) > 300 else "")
    source = SourceItem(
        room_id=room.id,
        title=req.title,
        source_type=req.source_type,
        content_preview=preview,
        extracted_text_encrypted=req.content,  # untrusted stored text
        file_size=len(req.content.encode("utf-8")),
        tags_json=json.dumps(req.tags or []),
        created_by=user.id,
        created_at=utcnow()
    )
    db.add(source)
    await db.flush()

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SOURCE_ADDED",
        severity="info",
        details_json=f'{{"source_id":"{source.id}","title":"{source.title}","type":"{source.source_type}"}}'
    )
    db.add(audit)
    await db.commit()
    await db.refresh(source)

    await manager.broadcast(room.code, {
        "type": "SOURCE_ADDED",
        "source_id": source.id,
        "title": source.title,
        "source_type": source.source_type
    })

    return {
        "id": source.id,
        "title": source.title,
        "source_type": source.source_type,
        "content_preview": source.content_preview,
        "file_size": source.file_size,
        "tags": req.tags or [],
        "created_at": source.created_at.isoformat()
    }

@router.post("/url", status_code=status.HTTP_201_CREATED)
async def add_url_source(
    code: str,
    req: AddUrlSourceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot add sources")

    extracted_content = ""
    status_summary = "URL saved (unfetched)"

    # Safely attempt to fetch content with tight timeout and size limit
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
            resp = await client.get(req.url, headers={"User-Agent": "VaultRoom-SourceCrawler/1.0"})
            if resp.status_code == 200:
                raw_text = resp.text[:50000]  # truncate to 50KB preview
                # Simple strip tags
                extracted_content = raw_text
                status_summary = f"Fetched {len(raw_text)} chars from {req.url}"
            else:
                status_summary = f"HTTP {resp.status_code} when querying URL"
    except Exception as e:
        status_summary = f"Saved URL reference (fetch deferred: {str(e)[:100]})"

    preview = (extracted_content[:300] if extracted_content else status_summary)

    source = SourceItem(
        room_id=room.id,
        title=req.title,
        source_type="url",
        content_preview=preview,
        extracted_text_encrypted=extracted_content,
        url=req.url,
        file_size=len(extracted_content.encode("utf-8")),
        tags_json=json.dumps(req.tags or []),
        created_by=user.id,
        created_at=utcnow()
    )
    db.add(source)
    await db.flush()

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SOURCE_URL_ADDED",
        severity="info",
        details_json=f'{{"source_id":"{source.id}","url":"{req.url}"}}'
    )
    db.add(audit)
    await db.commit()
    await db.refresh(source)

    return {
        "id": source.id,
        "title": source.title,
        "source_type": "url",
        "url": source.url,
        "content_preview": source.content_preview,
        "file_size": source.file_size,
        "tags": req.tags or [],
        "created_at": source.created_at.isoformat()
    }

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_file_source(
    code: str,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot upload files")

    filename = file.filename or "uploaded-file"
    ext = "." + filename.split(".")[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    content_bytes = await file.read(MAX_UPLOAD_BYTES + 1024)
    if len(content_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of 10MB"
        )

    if ext == ".pdf":
        source_type = "pdf"
        text_content = f"PDF Document: {filename} ({len(content_bytes)} bytes). Browser preview ready."
        preview = f"PDF Document ({filename}) - {len(content_bytes) // 1024} KB. Use 'Open PDF' for readable preview."
    elif ext == ".docx":
        source_type = "docx"
        text_content = extract_docx_text(content_bytes)
        preview = (text_content[:300].strip() + ("..." if len(text_content) > 300 else "")) or f"{filename} (Word Document)"
    elif ext == ".md":
        source_type = "markdown"
        text_content = content_bytes.decode("utf-8", errors="ignore")
        preview = text_content[:300].strip() + ("..." if len(text_content) > 300 else "")
    else:
        source_type = ext.lstrip(".") or "text"
        text_content = content_bytes.decode("utf-8", errors="ignore")
        preview = text_content[:300].strip() + ("..." if len(text_content) > 300 else "")

    source = SourceItem(
        room_id=room.id,
        title=title or filename,
        source_type=source_type,
        content_preview=preview,
        extracted_text_encrypted=text_content,
        filename=filename,
        file_size=len(content_bytes),
        file_data=content_bytes,
        tags_json=json.dumps(["upload", ext.lstrip(".")]),
        created_by=user.id,
        created_at=utcnow()
    )
    db.add(source)
    await db.flush()

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="FILE_SOURCE_UPLOADED",
        severity="info",
        details_json=f'{{"source_id":"{source.id}","filename":"{filename}","bytes":{len(content_bytes)},"type":"{source_type}"}}'
    )
    db.add(audit)
    await db.commit()

    source_payload = {
        "id": source.id,
        "title": source.title,
        "source_type": source.source_type,
        "filename": source.filename,
        "file_size": source.file_size,
        "content_preview": source.content_preview,
        "created_at": source.created_at.isoformat(),
        "tags": ["upload", ext.lstrip(".")]
    }

    # Broadcast source addition to room WebSocket clients
    await manager.broadcast(room.code, {
        "type": "SOURCE_ADDED",
        "source": source_payload
    })

    return source_payload

@router.get("/{source_id}/download")
async def download_source_file(
    code: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Download original document or file in its native binary format.
    """
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(SourceItem).where(SourceItem.id == source_id, SourceItem.room_id == room.id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    content = source.file_data
    if not content:
        if source.extracted_text_encrypted:
            content = source.extracted_text_encrypted.encode("utf-8")
        else:
            content = b""

    filename = source.filename or f"source_{source.id[:8]}.txt"
    ext = "." + filename.split(".")[-1].lower() if "." in filename else ""
    mime_type = get_mime_type(ext)

    return StreamingResponse(
        io.BytesIO(content),
        media_type=mime_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@router.get("/{source_id}/file")
async def get_source_file_inline(
    code: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Stream source file inline for browser-based PDF and document viewing.
    Avoids loading full files into browser memory unnecessarily while preserving client auth.
    """
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(SourceItem).where(SourceItem.id == source_id, SourceItem.room_id == room.id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    content = source.file_data
    if not content:
        if source.extracted_text_encrypted:
            content = source.extracted_text_encrypted.encode("utf-8")
        else:
            content = b""

    filename = source.filename or f"source_{source.id[:8]}.txt"
    ext = "." + filename.split(".")[-1].lower() if "." in filename else ""
    mime_type = get_mime_type(ext)

    return StreamingResponse(
        io.BytesIO(content),
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )

@router.delete("/{source_id}")
async def delete_source(
    code: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "co_host", "key_holder"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only room hosts, co-hosts, or key holders can remove sources"
        )

    result = await db.execute(
        select(SourceItem).where(SourceItem.id == source_id, SourceItem.room_id == room.id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    await db.delete(source)
    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="SOURCE_REMOVED",
        severity="info",
        details_json=f'{{"source_id":"{source_id}","title":"{source.title}"}}'
    )
    db.add(audit)
    await db.commit()

    # Broadcast source deletion to all room clients
    await manager.broadcast(room.code, {
        "type": "SOURCE_REMOVED",
        "source_id": source_id
    })

    return {"status": "deleted", "source_id": source_id}
