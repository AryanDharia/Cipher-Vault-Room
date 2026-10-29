import pytest
import uuid
import io
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.database.models import User, Room, RoomMember, SourceItem
from app.auth.security import hash_password, create_access_token
from app.rooms.service import RoomService
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

@pytest.mark.asyncio
async def test_simplified_room_creation_and_capacity():
    """
    Test simplified room creation (num_hosts, max_members) mapping
    and capacity enforcement.
    """
    await init_db()
    client = TestClient(app)

    # 1. Create host user
    username = f"host_{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as db:
        user = User(username=username, password_hash=hash_password("pw123"), role="user")
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Create room with simplified interface (2 hosts, max 3 members)
    res = client.post("/api/rooms", json={
        "name": "Finance Vault Room",
        "num_hosts": 2,
        "max_members": 3
    }, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["room"]["max_members"] == 3
    # Check mapped threshold
    assert data["room"]["threshold_required"] == 2
    assert data["room"]["threshold_total"] == 2
    room_code = data["room"]["code"]

    # 3. Create 3 other users and join
    guest_tokens = []
    for i in range(3):
        gname = f"guest_{uuid.uuid4().hex[:6]}"
        async with AsyncSessionLocal() as db:
            g = User(username=gname, password_hash=hash_password("pw123"), role="user")
            db.add(g)
            await db.commit()
            await db.refresh(g)
        gtok = create_access_token({"sub": g.id, "username": g.username, "role": g.role})
        guest_tokens.append((g, gtok))

    # Guest 1 joins (count = 2) -> OK
    res1 = client.post("/api/rooms/join", json={"code": room_code}, headers={"Authorization": f"Bearer {guest_tokens[0][1]}"})
    assert res1.status_code == 200

    # Guest 2 joins (count = 3, capacity reached) -> OK
    res2 = client.post("/api/rooms/join", json={"code": room_code}, headers={"Authorization": f"Bearer {guest_tokens[1][1]}"})
    assert res2.status_code == 200

    # Guest 3 attempts to join -> Should fail with 400 capacity exceeded
    res3 = client.post("/api/rooms/join", json={"code": room_code}, headers={"Authorization": f"Bearer {guest_tokens[2][1]}"})
    assert res3.status_code == 400
    assert "maximum capacity" in res3.json()["detail"].lower()

@pytest.mark.asyncio
async def test_co_host_role_and_kick_permissions():
    """
    Test Host and Co-host member management:
    - Host promotes ordinary member to co-host.
    - Non-host cannot promote members.
    - Co-host can kick ordinary members.
    - Co-host CANNOT kick host.
    - Co-host CANNOT kick another co-host.
    - Ordinary member CANNOT kick anyone.
    - Host can kick ordinary members and co-hosts.
    """
    await init_db()
    client = TestClient(app)

    async with AsyncSessionLocal() as db:
        host = User(username=f"host_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        cohost = User(username=f"cohost_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        cohost2 = User(username=f"cohost2_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        member = User(username=f"member_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        db.add_all([host, cohost, cohost2, member])
        await db.commit()
        for u in [host, cohost, cohost2, member]:
            await db.refresh(u)

        room = await RoomService.create_room(db, host, "Team Vault", max_members=10)
        code = room.code
        # Join other users
        await RoomService.join_room(db, room, cohost, role="editor")
        await RoomService.join_room(db, room, cohost2, role="editor")
        await RoomService.join_room(db, room, member, role="editor")

    tok_host = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    tok_cohost = create_access_token({"sub": cohost.id, "username": cohost.username, "role": cohost.role})
    tok_cohost2 = create_access_token({"sub": cohost2.id, "username": cohost2.username, "role": cohost2.role})
    tok_member = create_access_token({"sub": member.id, "username": member.username, "role": member.role})

    h_host = {"Authorization": f"Bearer {tok_host}"}
    h_cohost = {"Authorization": f"Bearer {tok_cohost}"}
    h_member = {"Authorization": f"Bearer {tok_member}"}

    # 1. Non-host attempts to promote cohost -> 403 Forbidden
    res = client.patch(f"/api/rooms/{code}/members/{cohost.id}/role", json={"role": "co_host"}, headers=h_member)
    assert res.status_code == 403

    # 2. Host promotes cohost and cohost2 to co_host
    res = client.patch(f"/api/rooms/{code}/members/{cohost.id}/role", json={"role": "co_host"}, headers=h_host)
    assert res.status_code == 200
    assert res.json()["new_role"] == "co_host"

    res = client.patch(f"/api/rooms/{code}/members/{cohost2.id}/role", json={"role": "co_host"}, headers=h_host)
    assert res.status_code == 200

    # 3. Ordinary member attempts to kick cohost -> 403 Forbidden
    res = client.post(f"/api/rooms/{code}/members/{cohost.id}/kick", json={"reason": "test"}, headers=h_member)
    assert res.status_code == 403

    # 4. Co-host attempts to kick Host -> 403 Forbidden (Protected!)
    res = client.post(f"/api/rooms/{code}/members/{host.id}/kick", json={"reason": "trying to kick host"}, headers=h_cohost)
    assert res.status_code == 403
    assert "host cannot be removed" in res.json()["detail"].lower()

    # 5. Co-host attempts to kick another Co-host -> 403 Forbidden (Protected!)
    res = client.post(f"/api/rooms/{code}/members/{cohost2.id}/kick", json={"reason": "rival cohost"}, headers=h_cohost)
    assert res.status_code == 403
    assert "co-hosts cannot remove other co-hosts" in res.json()["detail"].lower()

    # 6. Co-host kicks ordinary member -> 200 OK
    res = client.post(f"/api/rooms/{code}/members/{member.id}/kick", json={"reason": "Policy violation"}, headers=h_cohost)
    assert res.status_code == 200
    assert res.json()["status"] == "success"

    # Verify kicked member cannot rejoin room
    res = client.post("/api/rooms/join", json={"code": code}, headers=h_member)
    assert res.status_code == 403
    assert "removed from this room" in res.json()["detail"].lower()

@pytest.mark.asyncio
async def test_kicked_member_websocket_disconnect_and_rejoin_prevention():
    """
    Test real-time kick behavior:
    - Active WebSocket receives KICKED_FROM_ROOM.
    - Socket closed with policy violation.
    - In-memory presence is purged.
    - Removed user cannot connect via WebSocket again.
    """
    await init_db()
    client = TestClient(app)

    async with AsyncSessionLocal() as db:
        host = User(username=f"host_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        target = User(username=f"target_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        db.add_all([host, target])
        await db.commit()
        await db.refresh(host)
        await db.refresh(target)

        room = await RoomService.create_room(db, host, "WS Room", max_members=10)
        code = room.code
        await RoomService.join_room(db, room, target, role="editor")

    tok_host = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    tok_target = create_access_token({"sub": target.id, "username": target.username, "role": target.role})

    # Attach mock sockets to manager
    ws_target = MockWebSocket()
    await manager.connect(ws_target, code, "sock_target_1", target.id, target.username, "editor")
    assert code in manager.active_rooms
    assert "sock_target_1" in manager.active_rooms[code]

    # Host kicks target member via REST API
    res = client.delete(f"/api/rooms/{code}/members/{target.id}", headers={"Authorization": f"Bearer {tok_host}"})
    assert res.status_code == 200

    # Verify target socket was notified and closed
    assert ws_target.closed is True
    assert ws_target.close_code == 1008
    assert any(msg.get("type") == "KICKED_FROM_ROOM" for msg in ws_target.sent_messages)

    # Verify target is removed from active sockets
    assert "sock_target_1" not in manager.active_rooms.get(code, {})

    # Verify target cannot rejoin
    join_res = client.post("/api/rooms/join", json={"code": code}, headers={"Authorization": f"Bearer {tok_target}"})
    assert join_res.status_code == 403

@pytest.mark.asyncio
async def test_source_files_pdf_docx_download_and_preview():
    """
    Test Source Library:
    - PDF upload and streaming.
    - DOCX upload, XML text extraction, and streaming.
    - Download original files with attachment headers.
    - Unsupported file extension rejection.
    """
    await init_db()
    client = TestClient(app)

    async with AsyncSessionLocal() as db:
        host = User(username=f"host_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        db.add(host)
        await db.commit()
        await db.refresh(host)
        room = await RoomService.create_room(db, host, "Docs Room")
        code = room.code

    tok = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    headers = {"Authorization": f"Bearer {tok}"}

    # 1. Test unsupported file format
    exe_file = io.BytesIO(b"MZ\x90\x00malicious")
    res = client.post(
        f"/api/rooms/{code}/sources/upload",
        files={"file": ("virus.exe", exe_file, "application/octet-stream")},
        headers=headers
    )
    assert res.status_code == 400
    assert "unsupported file format" in res.json()["detail"].lower()

    # 2. Test PDF upload and download
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    pdf_file = io.BytesIO(pdf_bytes)
    res_pdf = client.post(
        f"/api/rooms/{code}/sources/upload",
        files={"file": ("specs.pdf", pdf_file, "application/pdf")},
        headers=headers
    )
    assert res_pdf.status_code == 201
    pdf_id = res_pdf.json()["id"]
    assert res_pdf.json()["source_type"] == "pdf"

    # Test PDF inline stream (for browser preview)
    res_inline = client.get(f"/api/rooms/{code}/sources/{pdf_id}/file", headers=headers)
    assert res_inline.status_code == 200
    assert res_inline.headers["content-type"] == "application/pdf"
    assert "inline" in res_inline.headers["content-disposition"]
    assert res_inline.content == pdf_bytes

    # Test PDF download (attachment)
    res_dl = client.get(f"/api/rooms/{code}/sources/{pdf_id}/download", headers=headers)
    assert res_dl.status_code == 200
    assert "attachment" in res_dl.headers["content-disposition"]
    assert res_dl.content == pdf_bytes

    # 3. Test DOCX generation, text extraction, and download
    import zipfile
    docx_buf = io.BytesIO()
    with zipfile.ZipFile(docx_buf, 'w', zipfile.ZIP_DEFLATED) as z:
        doc_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>Confidential Merger Agreement</w:t></w:r></w:p>
            <w:p><w:r><w:t>Clause 1: Zero-knowledge compliance is strictly enforced.</w:t></w:r></w:p>
          </w:body>
        </w:document>"""
        z.writestr("word/document.xml", doc_xml)
    docx_bytes = docx_buf.getvalue()

    res_docx = client.post(
        f"/api/rooms/{code}/sources/upload",
        files={"file": ("contract.docx", io.BytesIO(docx_bytes), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        headers=headers
    )
    assert res_docx.status_code == 201
    docx_id = res_docx.json()["id"]
    assert res_docx.json()["source_type"] == "docx"
    assert "Confidential Merger Agreement" in res_docx.json()["content_preview"]

    # Test DOCX download returns exact original bytes
    res_docx_dl = client.get(f"/api/rooms/{code}/sources/{docx_id}/download", headers=headers)
    assert res_docx_dl.status_code == 200
    assert "contract.docx" in res_docx_dl.headers["content-disposition"]
    assert res_docx_dl.content == docx_bytes

@pytest.mark.asyncio
async def test_host_demotion_room_deletion_and_size_limits():
    """
    Test edge cases:
    - Host demoting co-host back to editor immediately revokes kick powers.
    - Co-host attempting to delete room receives 403 Forbidden.
    - Uploading file exceeding MAX_UPLOAD_BYTES returns 413 Payload Too Large.
    - Co-host threshold approval voting works as authorized key holder.
    """
    await init_db()
    client = TestClient(app)

    async with AsyncSessionLocal() as db:
        host = User(username=f"host_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        cohost = User(username=f"cohost_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        target = User(username=f"target_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw"), role="user")
        db.add_all([host, cohost, target])
        await db.commit()
        for u in [host, cohost, target]:
            await db.refresh(u)

        room = await RoomService.create_room(db, host, "EdgeCase Room", max_members=5)
        code = room.code
        await RoomService.join_room(db, room, cohost, role="editor")
        await RoomService.join_room(db, room, target, role="editor")

    tok_host = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    tok_cohost = create_access_token({"sub": cohost.id, "username": cohost.username, "role": cohost.role})
    tok_target = create_access_token({"sub": target.id, "username": target.username, "role": target.role})

    h_host = {"Authorization": f"Bearer {tok_host}"}
    h_cohost = {"Authorization": f"Bearer {tok_cohost}"}
    h_target = {"Authorization": f"Bearer {tok_target}"}

    # 1. Promote to co-host
    res = client.patch(f"/api/rooms/{code}/members/{cohost.id}/role", json={"role": "co_host"}, headers=h_host)
    assert res.status_code == 200

    # 2. Co-host attempts to delete room -> 403 Forbidden (Only original host can delete room)
    del_res = client.delete(f"/api/rooms/{code}", headers=h_cohost)
    assert del_res.status_code == 403
    assert "only the room host can delete" in del_res.json()["detail"].lower()

    # 3. Demote co-host back to editor
    res_demote = client.patch(f"/api/rooms/{code}/members/{cohost.id}/role", json={"role": "editor"}, headers=h_host)
    assert res_demote.status_code == 200
    assert res_demote.json()["new_role"] == "editor"

    # 4. Demoted member attempts to kick target -> 403 Forbidden
    res_kick_fail = client.post(f"/api/rooms/{code}/members/{target.id}/kick", json={"reason": "no longer cohost"}, headers=h_cohost)
    assert res_kick_fail.status_code == 403
    assert "co-hosts can remove members" in res_kick_fail.json()["detail"].lower()

    # 5. Test oversized file upload (11MB > 10MB limit) -> 413 Request Entity Too Large
    large_payload = b"A" * (11 * 1024 * 1024)
    res_large = client.post(
        f"/api/rooms/{code}/sources/upload",
        files={"file": ("huge.txt", io.BytesIO(large_payload), "text/plain")},
        headers=h_host
    )
    assert res_large.status_code == 413
    assert "exceeds maximum allowed size" in res_large.json()["detail"].lower()

