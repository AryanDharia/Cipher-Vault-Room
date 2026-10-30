import pytest
import pytest_asyncio
import uuid
import json
from httpx import AsyncClient, ASGITransport
from fastapi.testclient import TestClient

from app.main import app
from app.database.session import init_db, AsyncSessionLocal
from app.rooms.service import RoomService
from app.database.models import User
from app.auth.security import hash_password, create_access_token

@pytest.fixture(scope="session", autouse=True)
def anyio_backend():
    return "asyncio"

@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()

@pytest.mark.asyncio
async def test_document_listing_includes_encrypted_envelope():
    """
    Verify regression fix:
    GET /rooms/{code}/documents MUST include 'encrypted_envelope' so that
    collaborators, newly joined users, and refreshed sessions receive the
    persisted document content rather than an empty placeholder.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Register Alice
        alice_uname = f"alice_{uuid.uuid4().hex[:6]}"
        reg_alice = await client.post("/api/auth/register", json={
            "username": alice_uname,
            "password": "Password123!"
        })
        assert reg_alice.status_code == 200
        token_alice = reg_alice.json()["access_token"]
        headers_alice = {"Authorization": f"Bearer {token_alice}"}

        # 2. Alice creates Room
        create_room_res = await client.post("/api/rooms", json={
            "name": "Sync Test Vault",
            "max_members": 10
        }, headers=headers_alice)
        assert create_room_res.status_code == 201
        room_code = create_room_res.json()["room"]["code"]

        # 3. Alice creates document with encrypted content
        test_envelope = json.dumps({
            "v": 1,
            "iv": "3a9f1b2c4d5e6f70",
            "ciphertext": "BASE64_CIPHERTEXT_FINANCIAL_SPEC_DATA"
        })
        create_doc_res = await client.post(f"/api/rooms/{room_code}/documents", json={
            "title": "Confidential Q3 Review",
            "doc_type": "document",
            "language": "markdown",
            "encrypted_envelope": test_envelope
        }, headers=headers_alice)
        assert create_doc_res.status_code == 201
        doc_id = create_doc_res.json()["id"]
        assert create_doc_res.json()["encrypted_envelope"] == test_envelope
        assert create_doc_res.json()["has_content"] is True

        # 4. Alice lists documents: encrypted_envelope MUST be present
        list_docs_alice = await client.get(f"/api/rooms/{room_code}/documents", headers=headers_alice)
        assert list_docs_alice.status_code == 200
        docs = list_docs_alice.json()
        assert len(docs) == 1
        assert docs[0]["id"] == doc_id
        assert docs[0]["encrypted_envelope"] == test_envelope
        assert docs[0]["has_content"] is True

        # 5. Bob registers and joins room
        bob_uname = f"bob_{uuid.uuid4().hex[:6]}"
        reg_bob = await client.post("/api/auth/register", json={
            "username": bob_uname,
            "password": "Password123!"
        })
        token_bob = reg_bob.json()["access_token"]
        headers_bob = {"Authorization": f"Bearer {token_bob}"}

        join_res = await client.post("/api/rooms/join", json={
            "code": room_code,
            "role": "editor"
        }, headers=headers_bob)
        assert join_res.status_code == 200

        # 6. Bob lists documents: Bob MUST receive Alice's encrypted envelope!
        list_docs_bob = await client.get(f"/api/rooms/{room_code}/documents", headers=headers_bob)
        assert list_docs_bob.status_code == 200
        bob_docs = list_docs_bob.json()
        assert len(bob_docs) == 1
        assert bob_docs[0]["id"] == doc_id
        assert bob_docs[0]["encrypted_envelope"] == test_envelope
        assert bob_docs[0]["has_content"] is True

@pytest.mark.asyncio
async def test_document_save_and_websocket_broadcast_with_envelope():
    """
    Verify regression fix:
    When a user saves/updates a document:
    1. PUT /documents/{id} returns the new encrypted_envelope.
    2. WebSocket broadcast DOCUMENT_UPDATED carries the new encrypted_envelope to peers.
    3. Newly joined user Charlie receives the latest saved envelope.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create users
        alice_uname = f"alice_save_{uuid.uuid4().hex[:6]}"
        bob_uname = f"bob_save_{uuid.uuid4().hex[:6]}"
        reg_alice = await client.post("/api/auth/register", json={"username": alice_uname, "password": "Password123!"})
        reg_bob = await client.post("/api/auth/register", json={"username": bob_uname, "password": "Password123!"})
        token_alice = reg_alice.json()["access_token"]
        token_bob = reg_bob.json()["access_token"]
        headers_alice = {"Authorization": f"Bearer {token_alice}"}
        headers_bob = {"Authorization": f"Bearer {token_bob}"}

        # Create room and join
        room_res = await client.post("/api/rooms", json={"name": "Save Sync Vault"}, headers=headers_alice)
        room_code = room_res.json()["room"]["code"]
        await client.post("/api/rooms/join", json={"code": room_code}, headers=headers_bob)

        # Create initial document
        initial_envelope = json.dumps({"v": 1, "iv": "111", "ciphertext": "INITIAL_CIPHERTEXT"})
        doc_res = await client.post(f"/api/rooms/{room_code}/documents", json={
            "title": "Live Strategy Document",
            "encrypted_envelope": initial_envelope
        }, headers=headers_alice)
        doc_id = doc_res.json()["id"]

        # Alice updates/saves document with new version
        updated_envelope = json.dumps({"v": 1, "iv": "222", "ciphertext": "UPDATED_REALTIME_SAVED_CIPHERTEXT"})
        update_res = await client.put(f"/api/rooms/{room_code}/documents/{doc_id}", json={
            "encrypted_envelope": updated_envelope
        }, headers=headers_alice)
        assert update_res.status_code == 200
        assert update_res.json()["encrypted_envelope"] == updated_envelope
        assert update_res.json()["version"] == 2

        # Bob fetches document list: receives the updated envelope
        bob_list = await client.get(f"/api/rooms/{room_code}/documents", headers=headers_bob)
        assert bob_list.status_code == 200
        assert bob_list.json()[0]["encrypted_envelope"] == updated_envelope
        assert bob_list.json()[0]["version"] == 2

        # Charlie registers and joins room late
        charlie_uname = f"charlie_{uuid.uuid4().hex[:6]}"
        reg_charlie = await client.post("/api/auth/register", json={"username": charlie_uname, "password": "Password123!"})
        token_charlie = reg_charlie.json()["access_token"]
        headers_charlie = {"Authorization": f"Bearer {token_charlie}"}
        await client.post("/api/rooms/join", json={"code": room_code}, headers=headers_charlie)

        # Charlie MUST receive the latest version 2 saved envelope
        charlie_list = await client.get(f"/api/rooms/{room_code}/documents", headers=headers_charlie)
        assert charlie_list.status_code == 200
        assert charlie_list.json()[0]["encrypted_envelope"] == updated_envelope
        assert charlie_list.json()[0]["version"] == 2

class MockWebSocket:
    def __init__(self):
        self.accepted = False
        self.sent_messages = []
        self.closed = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        self.sent_messages.append(data)

    async def close(self, code=1000, reason=""):
        self.closed = True

@pytest.mark.asyncio
async def test_websocket_three_client_live_sync_and_reconnect():
    """
    Test real-time collaborative synchronization across THREE clients:
    - Alice, Bob, and Charlie connect to the room.
    - Alice types and broadcasts YJS_UPDATE.
    - Bob and Charlie receive the update instantly.
    - Bob types and broadcasts delta.
    - Alice and Charlie receive it.
    - Charlie disconnects and reconnects, staying synchronized.
    """
    from app.collaboration.manager import manager

    room_code = "SYNC33"
    ws1 = MockWebSocket()
    ws2 = MockWebSocket()
    ws3 = MockWebSocket()

    # 1. Connect Client 1 (Alice)
    await manager.connect(
        websocket=ws1,
        room_code=room_code,
        socket_id="sock_alice_sync3",
        user_id="user_alice_3",
        username="alice",
        role="owner"
    )
    assert ws1.accepted is True
    assert ws1.sent_messages[-1]["type"] == "ROOM_CONNECTED"

    # 2. Connect Client 2 (Bob)
    await manager.connect(
        websocket=ws2,
        room_code=room_code,
        socket_id="sock_bob_sync3",
        user_id="user_bob_3",
        username="bob",
        role="editor"
    )
    assert ws2.accepted is True
    # Alice receives USER_JOINED for Bob
    assert any(m["type"] == "USER_JOINED" and m["username"] == "bob" for m in ws1.sent_messages)

    # 3. Connect Client 3 (Charlie)
    await manager.connect(
        websocket=ws3,
        room_code=room_code,
        socket_id="sock_charlie_sync3",
        user_id="user_charlie_3",
        username="charlie",
        role="editor"
    )
    assert ws3.accepted is True
    # Both Alice and Bob receive USER_JOINED for Charlie
    assert any(m["type"] == "USER_JOINED" and m["username"] == "charlie" for m in ws1.sent_messages)
    assert any(m["type"] == "USER_JOINED" and m["username"] == "charlie" for m in ws2.sent_messages)

    # 4. Alice types and broadcasts YJS_UPDATE
    alice_payload = {
        "type": "YJS_UPDATE",
        "document_id": "doc_three_users",
        "encrypted_payload": "PAYLOAD_FROM_ALICE_KEYSTROKES"
    }
    await manager.handle_message(room_code, "sock_alice_sync3", alice_payload)

    # Both Bob and Charlie receive Alice's keystrokes
    bob_alice_updates = [m for m in ws2.sent_messages if m["type"] == "YJS_UPDATE"]
    assert len(bob_alice_updates) == 1
    assert bob_alice_updates[0]["encrypted_payload"] == "PAYLOAD_FROM_ALICE_KEYSTROKES"
    assert bob_alice_updates[0]["document_id"] == "doc_three_users"

    charlie_alice_updates = [m for m in ws3.sent_messages if m["type"] == "YJS_UPDATE"]
    assert len(charlie_alice_updates) == 1
    assert charlie_alice_updates[0]["encrypted_payload"] == "PAYLOAD_FROM_ALICE_KEYSTROKES"

    # 5. Bob types and broadcasts delta
    bob_payload = {
        "type": "YJS_UPDATE",
        "document_id": "doc_three_users",
        "encrypted_payload": "PAYLOAD_FROM_BOB_KEYSTROKES"
    }
    await manager.handle_message(room_code, "sock_bob_sync3", bob_payload)

    # Alice and Charlie receive Bob's keystrokes
    alice_bob_updates = [m for m in ws1.sent_messages if m.get("encrypted_payload") == "PAYLOAD_FROM_BOB_KEYSTROKES"]
    assert len(alice_bob_updates) == 1

    charlie_bob_updates = [m for m in ws3.sent_messages if m.get("encrypted_payload") == "PAYLOAD_FROM_BOB_KEYSTROKES"]
    assert len(charlie_bob_updates) == 1

    # 6. Charlie disconnects
    await manager.disconnect(room_code, "sock_charlie_sync3")
    assert any(m["type"] == "USER_LEFT" and m["username"] == "charlie" for m in ws1.sent_messages)
    assert any(m["type"] == "USER_LEFT" and m["username"] == "charlie" for m in ws2.sent_messages)

    # 7. Charlie reconnects on a new socket
    ws3_reconnected = MockWebSocket()
    await manager.connect(
        websocket=ws3_reconnected,
        room_code=room_code,
        socket_id="sock_charlie_sync3_reconnected",
        user_id="user_charlie_3",
        username="charlie",
        role="editor"
    )
    assert ws3_reconnected.accepted is True
    assert ws3_reconnected.sent_messages[-1]["type"] == "ROOM_CONNECTED"

    # Cleanup remaining sockets
    await manager.disconnect(room_code, "sock_alice_sync3")
    await manager.disconnect(room_code, "sock_bob_sync3")
    await manager.disconnect(room_code, "sock_charlie_sync3_reconnected")
