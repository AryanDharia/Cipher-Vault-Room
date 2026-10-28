import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, ForeignKey, Text, Float
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)

def to_naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="user", nullable=False)
    email = Column(String(255), nullable=True)  # Optional legacy field, completely removed from auth
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    memberships = relationship("RoomMember", back_populates="user", cascade="all, delete-orphan")

class Room(Base):
    __tablename__ = "rooms"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String(6), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    creator_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)
    lock_reason = Column(String(255), nullable=True)
    threshold_required = Column(Integer, default=2, nullable=False)
    threshold_total = Column(Integer, default=3, nullable=False)

    members = relationship("RoomMember", back_populates="room", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="room", cascade="all, delete-orphan")
    secrets = relationship("VaultSecret", back_populates="room", cascade="all, delete-orphan")
    sources = relationship("SourceItem", back_populates="room", cascade="all, delete-orphan")
    audit_events = relationship("AuditEvent", back_populates="room", cascade="all, delete-orphan")
    approvals = relationship("ThresholdApproval", back_populates="room", cascade="all, delete-orphan")

class RoomMember(Base):
    __tablename__ = "room_members"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    role = Column(String(20), default="editor", nullable=False)  # owner, key_holder, editor, viewer
    joined_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    room = relationship("Room", back_populates="members")
    user = relationship("User", back_populates="memberships")

class Document(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    title = Column(String(255), default="Untitled Document", nullable=False)
    doc_type = Column(String(20), default="document", nullable=False)  # document, code
    language = Column(String(30), default="markdown", nullable=False)
    is_protected = Column(Boolean, default=False, nullable=False)
    # Zero-knowledge encrypted envelope: JSON string { iv, ciphertext, tag, v, salt }
    encrypted_envelope = Column(Text, nullable=True)
    version = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    room = relationship("Room", back_populates="documents")

class ThresholdApproval(Base):
    __tablename__ = "threshold_approvals"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    document_id = Column(String(36), nullable=True)
    requested_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    target_resource = Column(String(100), nullable=False)  # e.g., "doc:xyz", "secret:abc"
    status = Column(String(20), default="pending", nullable=False)  # pending, approved, rejected, expired
    required_count = Column(Integer, default=2, nullable=False)
    approvals_json = Column(Text, default="[]", nullable=False)  # JSON array of { user_id, username, timestamp, signature }
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    room = relationship("Room", back_populates="approvals")

class VaultSecret(Base):
    __tablename__ = "vault_secrets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    name = Column(String(100), nullable=False)
    category = Column(String(30), default="api_key", nullable=False)  # api_key, database, token, password, config
    encrypted_value = Column(Text, nullable=False)
    iv = Column(String(64), nullable=False)
    auth_tag = Column(String(64), nullable=True)
    description = Column(String(255), default="", nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_rotated_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    room = relationship("Room", back_populates="secrets")

class SourceItem(Base):
    __tablename__ = "source_items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    title = Column(String(255), nullable=False)
    source_type = Column(String(20), default="text", nullable=False)  # pdf, markdown, text, url
    content_preview = Column(Text, default="", nullable=False)
    extracted_text_encrypted = Column(Text, nullable=True)
    url = Column(String(1024), nullable=True)
    filename = Column(String(255), nullable=True)
    file_size = Column(Integer, default=0, nullable=False)
    tags_json = Column(Text, default="[]", nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    room = relationship("Room", back_populates="sources")

class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    user_id = Column(String(36), nullable=True)
    username = Column(String(50), nullable=False)
    event_type = Column(String(50), index=True, nullable=False)
    severity = Column(String(20), default="info", nullable=False)  # info, warning, critical, alert
    details_json = Column(Text, default="{}", nullable=False)
    is_simulated = Column(Boolean, default=False, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    room = relationship("Room", back_populates="audit_events")

class ExportRecord(Base):
    __tablename__ = "export_records"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    export_id = Column(String(64), unique=True, index=True, nullable=False)
    room_id = Column(String(36), ForeignKey("rooms.id"), index=True, nullable=False)
    document_id = Column(String(36), nullable=False)
    user_id = Column(String(36), nullable=False)
    user_name = Column(String(50), nullable=False)
    watermark_text = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
