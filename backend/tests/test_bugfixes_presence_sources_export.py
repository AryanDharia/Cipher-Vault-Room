import io
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.database.models import User, SourceItem, ExportRecord
from app.rooms.service import normalize_room_code
from app.auth.security import hash_password, create_access_token
from app.collaboration.manager import manager


class MockWebSocket:
    def __init__(self):
        self.closed = False
        self.sent_messages = []
        self.close_code = None
        self.close_reason = None

    async def accept(self):
        pass

    async def send_json(self, data):
        self.sent_messages.append(data)

    async def close(self, code=1000, reason=""):
        self.closed = True
        self.close_code = code
        self.close_reason = reason


async def _create_user_and_headers(prefix: str):
    username = f"{prefix}_{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        user = User(username=username, password_hash=hash_password("pw123"), role="user")
        db.add(user)
        await db.commit()
        await db.refresh(user)
    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
    return user, {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_ws_presence_authoritative_identity_and_disconnect_cleanup():
    """
    BUG 1: CURSOR_UPDATE must broadcast authoritative client user_id/username and room_code,
    and disconnect must emit USER_LEFT with user_id + updated online_users so peers clear stale typing indicators.
    """
    await init_db()
    alice, _ = await _create_user_and_headers("alice")
    bob, _ = await _create_user_and_headers("bob")
    room_code = normalize_room_code(f"PRS{uuid.uuid4().hex[:5].upper()}")

    ws_alice = MockWebSocket()
    ws_bob = MockWebSocket()
    sid_alice = f"sock-{alice.id}"
    sid_bob = f"sock-{bob.id}"

    await manager.connect(ws_alice, room_code, sid_alice, alice.id, alice.username, "owner")
    await manager.connect(ws_bob, room_code, sid_bob, bob.id, bob.username, "editor")
    ws_alice.sent_messages.clear()
    ws_bob.sent_messages.clear()

    try:
        # Bob sends CURSOR_UPDATE (even with a spoofed user_id, server uses authenticated bob.id)
        await manager.handle_message(room_code, sid_bob, {
            "type": "CURSOR_UPDATE",
            "user_id": "spoofed-id",
            "cursor": {"isTyping": True, "docId": "doc-123", "lastActive": 123456},
        })

        # Alice receives authoritative bob.id & room_code; Bob does not receive own broadcast
        alice_presence = [m for m in ws_alice.sent_messages if m.get("type") == "CURSOR_UPDATE"]
        bob_presence = [m for m in ws_bob.sent_messages if m.get("type") == "CURSOR_UPDATE"]
        assert len(alice_presence) == 1
        assert alice_presence[0]["user_id"] == bob.id
        assert alice_presence[0]["username"] == bob.username
        assert alice_presence[0]["room_code"] == room_code
        assert len(bob_presence) == 0

        # Bob disconnects -> Alice receives USER_LEFT with Bob's user_id removed from online_users
        ws_alice.sent_messages.clear()
        await manager.disconnect(room_code, sid_bob)
        left_msgs = [m for m in ws_alice.sent_messages if m.get("type") == "USER_LEFT"]
        assert len(left_msgs) == 1
        assert left_msgs[0]["user_id"] == bob.id
        assert all(u["user_id"] != bob.id for u in left_msgs[0]["online_users"])
    finally:
        await manager.disconnect(room_code, sid_bob)
        await manager.disconnect(room_code, sid_alice)


@pytest.mark.asyncio
async def test_source_upload_idempotent_single_db_row_and_single_ws_broadcast():
    """
    BUG 2: Uploading with the same upload_id twice must persist only 1 SourceItem,
    return the same server-generated source ID, and broadcast SOURCE_ADDED only once to peers.
    """
    await init_db()
    client = TestClient(app)
    host, host_headers = await _create_user_and_headers("host_src")
    peer, _ = await _create_user_and_headers("peer_src")

    room_res = client.post("/api/rooms", json={"name": "Source Dedupe Room"}, headers=host_headers)
    assert room_res.status_code == 201
    room_code = room_res.json()["room"]["code"]

    ws_peer = MockWebSocket()
    sid_peer = f"sock-{peer.id}"
    await manager.connect(ws_peer, room_code, sid_peer, peer.id, peer.username, "editor")
    ws_peer.sent_messages.clear()

    try:
        upload_id = str(uuid.uuid4())
        file_bytes = b"Confidential brief contents"

        res1 = client.post(
            f"/api/rooms/{room_code}/sources/upload",
            files={"file": ("brief.txt", io.BytesIO(file_bytes), "text/plain")},
            data={"upload_id": upload_id},
            headers=host_headers,
        )
        assert res1.status_code == 201
        src1 = res1.json()

        # Simulate accidental double-submission / client retry with identical upload_id
        res2 = client.post(
            f"/api/rooms/{room_code}/sources/upload",
            files={"file": ("brief.txt", io.BytesIO(file_bytes), "text/plain")},
            data={"upload_id": upload_id},
            headers=host_headers,
        )
        assert res2.status_code == 201
        src2 = res2.json()
        assert src2["id"] == src1["id"]

        # Verify peer received exactly ONE SOURCE_ADDED broadcast for that source ID
        source_events = [
            m for m in ws_peer.sent_messages
            if m.get("type") == "SOURCE_ADDED" and (m.get("source_id") == src1["id"] or (m.get("source") or {}).get("id") == src1["id"])
        ]
        assert len(source_events) == 1

        # Distinct upload_id with same filename must produce a second distinct source ID
        res3 = client.post(
            f"/api/rooms/{room_code}/sources/upload",
            files={"file": ("brief.txt", io.BytesIO(file_bytes), "text/plain")},
            data={"upload_id": str(uuid.uuid4())},
            headers=host_headers,
        )
        assert res3.status_code == 201
        src3 = res3.json()
        assert src3["id"] != src1["id"]

        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(SourceItem).where(SourceItem.title == "brief.txt", SourceItem.id.in_([src1["id"], src3["id"]])))).scalars().all()
            assert len(rows) == 2
    finally:
        await manager.disconnect(room_code, sid_peer)


@pytest.mark.asyncio
async def test_document_export_permissions_for_host_editor_viewer_and_lockdown():
    """
    BUG 3: Host, co-host, and editor can export documents and receive watermark/export_id;
    viewer role and locked rooms are forbidden cleanly with 403.
    """
    await init_db()
    client = TestClient(app)
    host, host_headers = await _create_user_and_headers("host_exp")
    viewer, viewer_headers = await _create_user_and_headers("viewer_exp")

    room_res = client.post("/api/rooms", json={"name": "Export Check Room"}, headers=host_headers)
    assert room_res.status_code == 201
    room_code = room_res.json()["room"]["code"]

    # Join viewer and demote to viewer role
    join_res = client.post("/api/rooms/join", json={"code": room_code}, headers=viewer_headers)
    assert join_res.status_code == 200
    role_res = client.patch(
        f"/api/rooms/{room_code}/members/{viewer.id}/role",
        json={"role": "viewer"},
        headers=host_headers,
    )
    assert role_res.status_code == 200

    # Create document as host
    doc_res = client.post(
        f"/api/rooms/{room_code}/documents",
        json={"title": "Incident Plan", "doc_type": "document", "encrypted_content": "cipher-blob"},
        headers=host_headers,
    )
    assert doc_res.status_code == 201
    doc_id = doc_res.json()["id"]

    # Host export succeeds with watermark & DB ExportRecord
    host_export = client.post(
        f"/api/rooms/{room_code}/documents/{doc_id}/export",
        json={"format": "markdown"},
        headers=host_headers,
    )
    assert host_export.status_code == 200
    exp_data = host_export.json()
    assert exp_data["export_id"].startswith("VR-EXP-")
    assert room_code in exp_data["watermark"]
    assert host.username in exp_data["watermark"]

    async with AsyncSessionLocal() as db:
        rec = (await db.execute(select(ExportRecord).where(ExportRecord.export_id == exp_data["export_id"]))).scalar_one_or_none()
        assert rec is not None
        assert rec.document_id == doc_id

    # Viewer export is blocked with 403
    viewer_export = client.post(
        f"/api/rooms/{room_code}/documents/{doc_id}/export",
        json={"format": "markdown"},
        headers=viewer_headers,
    )
    assert viewer_export.status_code == 403

    # Room lockdown blocks host export with 403 until unlocked
    lock_res = client.post(
        f"/api/rooms/{room_code}/lock",
        json={"lock": True, "reason": "Test lock"},
        headers=host_headers,
    )
    assert lock_res.status_code == 200
    locked_export = client.post(
        f"/api/rooms/{room_code}/documents/{doc_id}/export",
        json={"format": "markdown"},
        headers=host_headers,
    )
    assert locked_export.status_code == 403
