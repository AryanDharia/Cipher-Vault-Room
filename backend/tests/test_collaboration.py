import pytest
import pytest_asyncio
import uuid
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, func
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


@pytest.mark.asyncio
async def test_simultaneous_rooms_isolate_updates_presence_and_disconnects():
    """Two live rooms remain independent while both relay document updates."""
    rooms = {
        "RMA2AA": [MockWebSocket(), MockWebSocket()],
        "RMB2BB": [MockWebSocket(), MockWebSocket()],
    }
    sockets = {}
    for code, peers in rooms.items():
        for index, ws in enumerate(peers):
            socket_id = f"{code}-{index}"
            sockets[(code, index)] = socket_id
            await manager.connect(
                websocket=ws,
                room_code=code,
                socket_id=socket_id,
                user_id=f"user-{code}-{index}",
                username=f"user-{index}",
                role="editor",
            )

    await manager.handle_message("RMA2AA", sockets[("RMA2AA", 0)], {
        "type": "YJS_UPDATE", "document_id": "doc-room-a", "encrypted_payload": "update-a"
    })
    await manager.handle_message("RMB2BB", sockets[("RMB2BB", 0)], {
        "type": "YJS_UPDATE", "document_id": "doc-room-b", "encrypted_payload": "update-b"
    })

    room_a_peer = rooms["RMA2AA"][1]
    room_b_peer = rooms["RMB2BB"][1]
    assert [m["encrypted_payload"] for m in room_a_peer.sent_messages if m["type"] == "YJS_UPDATE"] == ["update-a"]
    assert [m["encrypted_payload"] for m in room_b_peer.sent_messages if m["type"] == "YJS_UPDATE"] == ["update-b"]
    assert not any(m.get("encrypted_payload") == "update-b" for m in room_a_peer.sent_messages)
    assert not any(m.get("encrypted_payload") == "update-a" for m in room_b_peer.sent_messages)

    await manager.disconnect("RMA2AA", sockets[("RMA2AA", 0)])
    assert len(manager.active_rooms["RMB2BB"]) == 2
    assert len(manager.get_online_users("RMB2BB")) == 2

    for code, peers in rooms.items():
        for index in range(2):
            await manager.disconnect(code, sockets[(code, index)])

from fastapi.testclient import TestClient
from app.auth.security import create_access_token
from app.rooms.service import RoomService
from app.database.session import AsyncSessionLocal
from app.database.models import User, Document, DocumentUpdate
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
            doc = Document(room_id=room.id, title="Shared WebSocket Document")
            db.add(doc)
            foreign_room = await RoomService.create_room(db, bob, name="Foreign Collaboration Room")
            foreign_doc = Document(room_id=foreign_room.id, title="Private Foreign Document")
            db.add(foreign_doc)
            await db.commit()
            await db.refresh(doc)
            await db.refresh(foreign_doc)
            return alice, bob, room, doc, foreign_doc

    alice, bob, room, doc, foreign_doc = asyncio.run(create_users_and_room())
    update_id = str(uuid.uuid4())

    token_alice = create_access_token({"sub": alice.id, "username": alice.username, "role": alice.role})
    token_bob = create_access_token({"sub": bob.id, "username": bob.username, "role": bob.role})

    client = TestClient(app)
    client.__enter__()

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

            # A room socket cannot inject updates for nonexistent or foreign documents.
            ws_alice.send_json({
                "type": "YJS_UPDATE",
                "document_id": str(uuid.uuid4()),
                "update_id": str(uuid.uuid4()),
                "encrypted_payload": "forged"
            })
            rejected = ws_alice.receive_json()
            assert rejected["type"] == "ERROR"
            assert "document" in rejected["message"].lower()

            foreign_update_id = str(uuid.uuid4())
            ws_alice.send_json({
                "type": "YJS_UPDATE",
                "document_id": foreign_doc.id,
                "update_id": foreign_update_id,
                "encrypted_payload": "foreign-room-update",
            })
            rejected_foreign = ws_alice.receive_json()
            assert rejected_foreign["type"] == "ERROR"
            assert rejected_foreign["update_id"] == foreign_update_id

            # Alice sends YJS_UPDATE
            ws_alice.send_json({
                "type": "YJS_UPDATE",
                "document_id": doc.id,
                "update_id": update_id,
                "encrypted_payload": "E2EE_PAYLOAD_TEST"
            })

            # Bob receives YJS_UPDATE
            update_msg = ws_bob.receive_json()
            assert update_msg["type"] == "YJS_UPDATE"
            assert update_msg["document_id"] == doc.id
            assert update_msg["encrypted_payload"] == "E2EE_PAYLOAD_TEST"

            # The sender is told only after the update and document timestamp
            # commit, so the client never infers persistence from send().
            persisted_ack = ws_alice.receive_json()
            assert persisted_ack["type"] == "YJS_UPDATE_ACK"
            assert persisted_ack["document_id"] == doc.id
            assert persisted_ack["update_id"] == update_id
            assert persisted_ack["persisted_at"].endswith("Z")

            # A retry after a lost ack receives a fresh ack without creating a
            # second database row for the same CRDT update id.
            ws_alice.send_json({
                "type": "YJS_UPDATE",
                "document_id": doc.id,
                "update_id": update_id,
                "encrypted_payload": "E2EE_PAYLOAD_TEST",
            })
            retry_ack = ws_alice.receive_json()
            assert retry_ack["type"] == "YJS_UPDATE_ACK"
            assert retry_ack["update_id"] == update_id
            assert ws_bob.receive_json()["type"] == "YJS_UPDATE"

            # Ping Pong check
            ws_bob.send_json({"type": "PING"})
            pong_msg = ws_bob.receive_json()
            assert pong_msg["type"] == "PONG"

    client.__exit__(None, None, None)

    async def read_persisted_update():
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(DocumentUpdate).where(DocumentUpdate.id == update_id))
            count = await db.execute(select(func.count(DocumentUpdate.id)).where(DocumentUpdate.id == update_id))
            persisted_doc = await db.execute(select(Document).where(Document.id == doc.id))
            return result.scalar_one_or_none(), count.scalar_one(), persisted_doc.scalar_one()

    persisted_update, persisted_count, persisted_doc = asyncio.run(read_persisted_update())
    assert persisted_update is not None
    assert persisted_count == 1
    assert persisted_update.room_id == room.id
    assert persisted_update.document_id == doc.id
    assert persisted_update.encrypted_payload == "E2EE_PAYLOAD_TEST"
    assert retry_ack["persisted_at"] == persisted_doc.updated_at.isoformat() + "Z"


def test_authenticated_websocket_sync_runs_in_two_rooms_simultaneously():
    """Two authenticated peers in each room persist and relay only their room's updates."""
    import asyncio

    async def create_rooms_and_users():
        async with AsyncSessionLocal() as db:
            alice = User(username=f"alice_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pass123"), role="user")
            bob = User(username=f"bob_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pass123"), role="user")
            carol = User(username=f"carol_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pass123"), role="user")
            dave = User(username=f"dave_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pass123"), role="user")
            db.add_all([alice, bob, carol, dave])
            await db.commit()
            for user in (alice, bob, carol, dave):
                await db.refresh(user)

            room_a = await RoomService.create_room(db, alice, name="Concurrent Room A")
            room_b = await RoomService.create_room(db, carol, name="Concurrent Room B")
            doc_a = Document(room_id=room_a.id, title="Room A document")
            doc_b = Document(room_id=room_b.id, title="Room B document")
            db.add_all([doc_a, doc_b])
            await db.commit()
            await db.refresh(doc_a)
            await db.refresh(doc_b)
            return (alice, bob, room_a, doc_a), (carol, dave, room_b, doc_b)

    room_a_data, room_b_data = asyncio.run(create_rooms_and_users())
    alice, bob, room_a, doc_a = room_a_data
    carol, dave, room_b, doc_b = room_b_data
    tokens = [
        create_access_token({"sub": user.id, "username": user.username, "role": user.role})
        for user in (alice, bob, carol, dave)
    ]
    client = TestClient(app)

    with client.websocket_connect(f"/ws/{room_a.code}?token={tokens[0]}") as alice_ws:
        assert alice_ws.receive_json()["type"] == "ROOM_CONNECTED"
        with client.websocket_connect(f"/ws/{room_a.code}?token={tokens[1]}") as bob_ws:
            assert bob_ws.receive_json()["type"] == "ROOM_CONNECTED"
            assert alice_ws.receive_json()["type"] == "USER_JOINED"
            with client.websocket_connect(f"/ws/{room_b.code}?token={tokens[2]}") as carol_ws:
                assert carol_ws.receive_json()["type"] == "ROOM_CONNECTED"
                with client.websocket_connect(f"/ws/{room_b.code}?token={tokens[3]}") as dave_ws:
                    assert dave_ws.receive_json()["type"] == "ROOM_CONNECTED"
                    assert carol_ws.receive_json()["type"] == "USER_JOINED"

                    update_a_id = str(uuid.uuid4())
                    alice_ws.send_json({
                        "type": "YJS_UPDATE", "document_id": doc_a.id,
                        "update_id": update_a_id, "encrypted_payload": "opaque-room-a-state",
                    })
                    ack_a = alice_ws.receive_json()
                    relay_a = bob_ws.receive_json()
                    assert ack_a["type"] == "YJS_UPDATE_ACK" and ack_a["update_id"] == update_a_id
                    assert relay_a["document_id"] == doc_a.id
                    assert relay_a["encrypted_payload"] == "opaque-room-a-state"

                    update_b_id = str(uuid.uuid4())
                    carol_ws.send_json({
                        "type": "YJS_UPDATE", "document_id": doc_b.id,
                        "update_id": update_b_id, "encrypted_payload": "opaque-room-b-state",
                    })
                    ack_b = carol_ws.receive_json()
                    relay_b = dave_ws.receive_json()
                    assert ack_b["type"] == "YJS_UPDATE_ACK" and ack_b["update_id"] == update_b_id
                    assert relay_b["document_id"] == doc_b.id
                    assert relay_b["encrypted_payload"] == "opaque-room-b-state"

    async def read_room_updates():
        async with AsyncSessionLocal() as db:
            updates = (await db.execute(
                select(DocumentUpdate).where(DocumentUpdate.id.in_([update_a_id, update_b_id]))
            )).scalars().all()
            return {item.id: (item.room_id, item.document_id) for item in updates}

    persisted = asyncio.run(read_room_updates())
    assert persisted == {
        update_a_id: (room_a.id, doc_a.id),
        update_b_id: (room_b.id, doc_b.id),
    }

