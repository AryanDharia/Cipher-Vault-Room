import asyncio
import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.database.models import (
    User, Room, RoomMember, Document, AuditEvent,
    VaultSecret, SourceItem, ThresholdApproval, ExportRecord
)
from app.rooms.service import RoomService, generate_random_room_code
from app.auth.security import create_access_token, hash_password
from app.collaboration.manager import manager

class MockWebSocket:
    def __init__(self):
        self.accepted = False
        self.closed = False
        self.close_code = None
        self.close_reason = None
        self.sent_messages = []

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        self.sent_messages.append(data)

    async def close(self, code=1000, reason=""):
        self.closed = True
        self.close_code = code
        self.close_reason = reason

@pytest.mark.asyncio
async def test_host_only_room_deletion():
    """
    Test Requirement 1 & 7:
    - Host can delete room.
    - Non-host receives HTTP 403 Forbidden.
    - All connected users receive ROOM_DELETED and are disconnected.
    - Deleted room & all child records are absent from the database.
    - Reconnection/access to deleted room fails.
    """
    await init_db()

    # 1. Create Host and Guest users in DB
    host_username = f"host_{uuid.uuid4().hex[:6]}"
    guest_username = f"guest_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_username, password_hash=hash_password("hostpass123"), role="user")
        guest = User(username=guest_username, password_hash=hash_password("guestpass123"), role="user")
        db.add(host)
        db.add(guest)
        await db.commit()
        await db.refresh(host)
        await db.refresh(guest)

        # 2. Host creates a room
        room = await RoomService.create_room(db, creator=host, name="Secure Vault Room")
        room_code = room.code
        room_id = room.id

        # Add guest as editor member
        guest_member = RoomMember(room_id=room_id, user_id=guest.id, role="editor")
        db.add(guest_member)

        # Add a document, secret, source, and approval to verify complete cascading deletion
        doc = Document(room_id=room_id, title="Secret Document", encrypted_envelope='{"iv":"1","ciphertext":"abc"}')
        db.add(doc)
        await db.flush()

        secret = VaultSecret(room_id=room_id, name="DB_KEY", encrypted_value="enc_val", iv="iv123", created_by=host.id)
        source = SourceItem(room_id=room_id, title="Research PDF", created_by=host.id)
        approval = ThresholdApproval(
            room_id=room_id, requested_by=host.id, target_resource="doc:xyz",
            expires_at=room.expires_at
        )
        export = ExportRecord(
            export_id=f"exp_{uuid.uuid4().hex[:8]}", room_id=room_id,
            document_id=doc.id, user_id=host.id, user_name=host.username,
            watermark_text="CONFIDENTIAL"
        )
        db.add_all([secret, source, approval, export])
        await db.commit()

    token_host = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    token_guest = create_access_token({"sub": guest.id, "username": guest.username, "role": guest.role})

    # 3. Connect Host and Guest to room via RoomConnectionManager
    ws_host = MockWebSocket()
    ws_guest = MockWebSocket()

    await manager.connect(ws_host, room_code, "sock_host", host.id, host.username, "owner")
    await manager.connect(ws_guest, room_code, "sock_guest", guest.id, guest.username, "editor")

    assert room_code in manager.active_rooms
    assert len(manager.active_rooms[room_code]) == 2

    client = TestClient(app)

    # 4. Non-host attempts to delete room -> MUST be rejected with HTTP 403 Forbidden
    res_guest = client.delete(
        f"/api/rooms/{room_code}",
        headers={"Authorization": f"Bearer {token_guest}"}
    )
    assert res_guest.status_code == 403
    assert "Only the room host can delete this room" in res_guest.json()["detail"]

    # Room is still intact in DB and in memory
    assert room_code in manager.active_rooms
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Room).where(Room.id == room_id))
        assert res.scalar_one_or_none() is not None

    # 5. Host deletes room -> MUST succeed with HTTP 200
    res_host = client.delete(
        f"/api/rooms/{room_code}",
        headers={"Authorization": f"Bearer {token_host}"}
    )
    assert res_host.status_code == 200
    assert res_host.json()["status"] == "success"

    # 6. Verify in-memory cleanup & WebSocket broadcast
    # Room MUST be completely purged from manager
    assert room_code not in manager.active_rooms
    assert room_code not in manager.room_presence

    # Sockets MUST have received ROOM_DELETED and been closed
    guest_del_events = [m for m in ws_guest.sent_messages if m.get("type") == "ROOM_DELETED"]
    assert len(guest_del_events) == 1
    assert "permanently deleted" in guest_del_events[0]["message"]
    assert ws_guest.closed is True

    host_del_events = [m for m in ws_host.sent_messages if m.get("type") == "ROOM_DELETED"]
    assert len(host_del_events) == 1
    assert ws_host.closed is True

    # 7. Verify persistent database cleanup: room and ALL child records are deleted
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(Room).where(Room.id == room_id))).scalar_one_or_none() is None
        assert (await db.execute(select(Document).where(Document.room_id == room_id))).scalars().all() == []
        assert (await db.execute(select(RoomMember).where(RoomMember.room_id == room_id))).scalars().all() == []
        assert (await db.execute(select(VaultSecret).where(VaultSecret.room_id == room_id))).scalars().all() == []
        assert (await db.execute(select(SourceItem).where(SourceItem.room_id == room_id))).scalars().all() == []
        assert (await db.execute(select(ThresholdApproval).where(ThresholdApproval.room_id == room_id))).scalars().all() == []
        assert (await db.execute(select(ExportRecord).where(ExportRecord.room_id == room_id))).scalars().all() == []

    # 8. Reconnecting or accessing the deleted room returns 404
    res_get = client.get(
        f"/api/rooms/{room_code}",
        headers={"Authorization": f"Bearer {token_host}"}
    )
    assert res_get.status_code == 404

@pytest.mark.asyncio
async def test_account_deletion_flow():
    """
    Test Requirement 3:
    - Account deletion requires re-authentication with password.
    - Wrong password rejected with HTTP 401.
    - Confirmed deletion deletes the user's account, owned rooms, and memberships.
    - Disconnects active sockets for that user.
    - Subsequent login attempts fail.
    - Does NOT delete other accounts or unrelated data!
    """
    await init_db()

    target_user = f"victim_{uuid.uuid4().hex[:6]}"
    other_user = f"bystander_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        u_target = User(username=target_user, password_hash=hash_password("correctpass123"), role="user")
        u_other = User(username=other_user, password_hash=hash_password("otherpass123"), role="user")
        db.add_all([u_target, u_other])
        await db.commit()
        await db.refresh(u_target)
        await db.refresh(u_other)

        # Target user creates a room
        room_target = await RoomService.create_room(db, creator=u_target, name="Target User Room")
        # Other user creates a separate room
        room_other = await RoomService.create_room(db, creator=u_other, name="Other User Room")

        target_room_code = room_target.code
        other_room_code = room_other.code
        target_id = u_target.id
        other_id = u_other.id

    token_target = create_access_token({"sub": target_id, "username": target_user, "role": "user"})
    client = TestClient(app)

    # 1. Attempt delete with WRONG password -> MUST fail with 401
    bad_res = client.request(
        "DELETE",
        "/api/auth/account",
        headers={"Authorization": f"Bearer {token_target}"},
        json={"password": "wrongpassword"}
    )
    assert bad_res.status_code == 401
    assert "Incorrect password" in bad_res.json()["detail"]

    # Verify user and room still exist
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(User).where(User.id == target_id))).scalar_one_or_none() is not None
        assert (await db.execute(select(Room).where(Room.code == target_room_code))).scalar_one_or_none() is not None

    # 2. Connect target user to a mock websocket
    ws_target = MockWebSocket()
    await manager.connect(ws_target, target_room_code, "sock_target_ws", target_id, target_user, "owner")

    # 3. Attempt delete with CORRECT password -> MUST succeed
    good_res = client.request(
        "DELETE",
        "/api/auth/account",
        headers={"Authorization": f"Bearer {token_target}"},
        json={"password": "correctpass123"}
    )
    assert good_res.status_code == 200
    assert good_res.json()["status"] == "success"

    # 4. Verify target user is absent from database
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(User).where(User.id == target_id))).scalar_one_or_none() is None
        # Owned room is also deleted
        assert (await db.execute(select(Room).where(Room.code == target_room_code))).scalar_one_or_none() is None

        # CRUCIAL: Bystander user and bystander room MUST REMAIN INTACT!
        assert (await db.execute(select(User).where(User.id == other_id))).scalar_one_or_none() is not None
        assert (await db.execute(select(Room).where(Room.code == other_room_code))).scalar_one_or_none() is not None

    # 5. Socket was disconnected
    assert ws_target.closed is True

    # 6. Subsequent login with deleted user credentials fails
    login_res = client.post("/api/auth/login", json={"username": target_user, "password": "correctpass123"})
    assert login_res.status_code == 401

@pytest.mark.asyncio
async def test_signout_safety_leaves_account_intact():
    """
    Test Requirement 2:
    - Sign out only clears local session tokens and disconnects active sockets.
    - Does NOT delete user account, rooms, or saved documents.
    """
    await init_db()

    uname = f"signout_user_{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        u = User(username=uname, password_hash=hash_password("pass123"), role="user")
        db.add(u)
        await db.commit()
        await db.refresh(u)

        r = await RoomService.create_room(db, creator=u, name="Signout Preserved Room")
        doc = Document(room_id=r.id, title="Preserved Doc", encrypted_envelope='{"data":"safe"}')
        db.add(doc)
        await db.commit()

        user_id = u.id
        room_code = r.code

    # Simulate client signout (WebSocket disconnect)
    ws = MockWebSocket()
    await manager.connect(ws, room_code, "sock_signout", user_id, uname, "owner")
    await manager.disconnect(room_code, "sock_signout")

    # Verify user, room, and doc STILL EXIST in DB
    async with AsyncSessionLocal() as db:
        u_db = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        r_db = (await db.execute(select(Room).where(Room.code == room_code))).scalar_one_or_none()
        doc_db = (await db.execute(select(Document).where(Document.room_id == r_db.id))).scalars().all()

        assert u_db is not None
        assert r_db is not None
        assert len(doc_db) == 1
        assert doc_db[0].title == "Preserved Doc"
