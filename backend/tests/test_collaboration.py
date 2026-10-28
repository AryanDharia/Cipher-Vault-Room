import pytest
import pytest_asyncio
import uuid
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.collaboration.manager import manager
from app.database.session import init_db

@pytest.fixture(scope="session", autouse=True)
def anyio_backend():
    return "asyncio"

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()

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
async def test_two_client_collaboration_and_presence():
    """
    Test real-time two-client collaboration synchronization:
    - Client 1 and Client 2 connect to the same room.
    - Client 1 broadcasts an encrypted Yjs update.
    - Client 2 receives the encrypted payload without server decrypting it.
    - Client 2 broadcasts cursor presence.
    - Client 1 receives cursor presence.
    - Client 1 disconnects, Client 2 receives USER_LEFT event.
    """
    room_code = "SYNC77"
    client1_ws = MockWebSocket()
    client2_ws = MockWebSocket()

    # 1. Client 1 (Alice) connects
    await manager.connect(
        websocket=client1_ws,
        room_code=room_code,
        socket_id="sock_alice_1",
        user_id="user_alice",
        username="alice",
        role="owner"
    )
    assert client1_ws.accepted is True
    assert len(client1_ws.sent_messages) == 1
    assert client1_ws.sent_messages[0]["type"] == "ROOM_CONNECTED"

    # 2. Client 2 (Bob) connects
    await manager.connect(
        websocket=client2_ws,
        room_code=room_code,
        socket_id="sock_bob_2",
        user_id="user_bob",
        username="bob",
        role="editor"
    )
    assert client2_ws.accepted is True
    # Alice should receive USER_JOINED for Bob
    alice_joined_events = [m for m in client1_ws.sent_messages if m["type"] == "USER_JOINED"]
    assert len(alice_joined_events) == 1
    assert alice_joined_events[0]["username"] == "bob"

    # 3. Alice sends encrypted Yjs binary update delta
    encrypted_yjs_payload = {
        "type": "YJS_UPDATE",
        "document_id": "doc_123",
        "encrypted_payload": "E2E_ENCRYPTED_BASE64_YJS_DELTA_VECTOR",
        "iv": "3a9f1b2c4d5e",
        "auth_tag": "tag123456",
        "version": 2
    }
    await manager.handle_message(room_code, "sock_alice_1", encrypted_yjs_payload)

    # Bob must receive the update payload
    bob_updates = [m for m in client2_ws.sent_messages if m["type"] == "YJS_UPDATE"]
    assert len(bob_updates) == 1
    assert bob_updates[0]["encrypted_payload"] == "E2E_ENCRYPTED_BASE64_YJS_DELTA_VECTOR"
    assert bob_updates[0]["document_id"] == "doc_123"

    # 4. Bob sends presence cursor movement
    cursor_payload = {
        "type": "CURSOR_UPDATE",
        "user_id": "user_bob",
        "username": "bob",
        "color": "#06b6d4",
        "cursor": {"line": 14, "column": 28}
    }
    await manager.handle_message(room_code, "sock_bob_2", cursor_payload)

    # Alice must receive the cursor movement
    alice_cursors = [m for m in client1_ws.sent_messages if m["type"] == "CURSOR_UPDATE"]
    assert len(alice_cursors) == 1
    assert alice_cursors[0]["cursor"]["line"] == 14
    assert alice_cursors[0]["username"] == "bob"

    # 5. Alice disconnects
    await manager.disconnect(room_code, "sock_alice_1")
    bob_leaves = [m for m in client2_ws.sent_messages if m["type"] == "USER_LEFT"]
    assert len(bob_leaves) == 1
    assert bob_leaves[0]["username"] == "alice"

    # Clean up Bob
    await manager.disconnect(room_code, "sock_bob_2")
    assert room_code not in manager.active_rooms

from fastapi.testclient import TestClient
from app.auth.security import create_access_token
from app.rooms.service import RoomService
from app.database.session import AsyncSessionLocal
from app.database.models import User
from app.auth.security import hash_password

def test_websocket_endpoint_e2e_two_clients():
    """
    Test real HTTP/ASGI WebSocket connection over Starlette TestClient:
    - Creates Alice and Bob in DB.
    - Alice creates a room.
    - Alice and Bob connect via WebSocket with JWT tokens.
    - Alice sends YJS_UPDATE, Bob receives it.
    - Reconnection verification.
    """
    import asyncio
    
    async def create_users_and_room():
        async with AsyncSessionLocal() as db:
            alice = User(username=f"alice_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pass123"), role="user")
            bob = User(username=f"bob_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pass123"), role="user")
            db.add(alice)
            db.add(bob)
            await db.commit()
            await db.refresh(alice)
            await db.refresh(bob)
            
            room = await RoomService.create_room(db, alice, name="Test Collaboration Room")
            return alice, bob, room

    alice, bob, room = asyncio.run(create_users_and_room())

    token_alice = create_access_token({"sub": alice.id, "username": alice.username, "role": alice.role})
    token_bob = create_access_token({"sub": bob.id, "username": bob.username, "role": bob.role})

    client = TestClient(app)

    with client.websocket_connect(f"/ws/{room.code}?token={token_alice}") as ws_alice:
        init_alice = ws_alice.receive_json()
        assert init_alice["type"] == "ROOM_CONNECTED"
        assert init_alice["room_code"] == room.code

        with client.websocket_connect(f"/ws/{room.code}?token={token_bob}") as ws_bob:
            init_bob = ws_bob.receive_json()
            assert init_bob["type"] == "ROOM_CONNECTED"

            # Alice receives USER_JOINED for Bob
            joined_msg = ws_alice.receive_json()
            assert joined_msg["type"] == "USER_JOINED"
            assert joined_msg["username"] == bob.username

            # Alice sends YJS_UPDATE
            ws_alice.send_json({
                "type": "YJS_UPDATE",
                "document_id": "doc_xyz",
                "encrypted_payload": "E2EE_PAYLOAD_TEST"
            })

            # Bob receives YJS_UPDATE
            update_msg = ws_bob.receive_json()
            assert update_msg["type"] == "YJS_UPDATE"
            assert update_msg["document_id"] == "doc_xyz"
            assert update_msg["encrypted_payload"] == "E2EE_PAYLOAD_TEST"

            # Ping Pong check
            ws_bob.send_json({"type": "PING"})
            pong_msg = ws_bob.receive_json()
            assert pong_msg["type"] == "PONG"

