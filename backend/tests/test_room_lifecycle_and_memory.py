import asyncio
import pytest
import os
import tracemalloc
from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.database.models import Room, Document, User
from app.collaboration.manager import manager
from app.rooms.service import RoomService, generate_random_room_code
from app.auth.security import create_access_token

tracemalloc.start()

def get_current_process_memory_mb() -> float:
    current, peak = tracemalloc.get_traced_memory()
    return current / (1024 * 1024)

class MockWebSocket:
    def __init__(self, should_fail: bool = False):
        self.accepted = False
        self.closed = False
        self.sent_messages = []
        self.should_fail = should_fail

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        if self.should_fail:
            raise ConnectionResetError("Connection lost")
        self.sent_messages.append(data)

    async def close(self, code=1000, reason=""):
        self.closed = True

@pytest.mark.asyncio
async def test_empty_room_cleanup_and_memory_reclaim():
    """Verify that when the last user disconnects, the room in-memory state is purged and DB marked inactive."""
    await init_db()
    mem_baseline = get_current_process_memory_mb()
    print(f"\n[MEMORY TEST] Baseline process memory: {mem_baseline:.2f} MB")

    # Generate unique test code with valid alphabet
    room_code = generate_random_room_code()
    async with AsyncSessionLocal() as db:
        user_res = await db.execute(select(User).where(User.username == "clean_user"))
        user = user_res.scalar_one_or_none()
        if not user:
            user = User(username="clean_user", password_hash="dummy_hash")
            db.add(user)
            await db.commit()
            await db.refresh(user)

        # Create room
        room = Room(
            code=room_code,
            name="Cleanup Test Room",
            creator_id=user.id,
            is_active=True,
            is_locked=False
        )
        db.add(room)
        await db.commit()
        await db.refresh(room)

        # Add a persisted document to prove document persistence is preserved
        doc = Document(
            room_id=room.id,
            title="Important Persistent Doc",
            doc_type="document",
            encrypted_envelope='{"iv":"123","ciphertext":"abc"}'
        )
        db.add(doc)
        await db.commit()

    # 2. Connect Client 1
    ws1 = MockWebSocket()
    await manager.connect(
        websocket=ws1,
        room_code=room_code,
        socket_id="sock_clean_1",
        user_id="user_clean_1",
        username="user1",
        role="owner"
    )

    assert room_code in manager.active_rooms
    assert "sock_clean_1" in manager.active_rooms[room_code]

    # Verify presence recorded
    await manager.handle_message(room_code, "sock_clean_1", {
        "type": "CURSOR_UPDATE",
        "user_id": "user_clean_1",
        "cursor": {"index": 42}
    })
    assert room_code in manager.room_presence
    assert "user_clean_1" in manager.room_presence[room_code]

    # 3. Connect Client 2
    ws2 = MockWebSocket()
    await manager.connect(
        websocket=ws2,
        room_code=room_code,
        socket_id="sock_clean_2",
        user_id="user_clean_2",
        username="user2",
        role="editor"
    )
    assert len(manager.active_rooms[room_code]) == 2

    # 4. Disconnect Client 1 (Room should remain active because Client 2 is still in room)
    await manager.disconnect(room_code, "sock_clean_1")
    assert room_code in manager.active_rooms
    assert len(manager.active_rooms[room_code]) == 1
    assert "sock_clean_1" not in manager.active_rooms[room_code]
    assert "sock_clean_1" not in manager.rate_limits

    # Client 1's presence was removed
    assert "user_clean_1" not in manager.room_presence.get(room_code, {})

    # Room is still active in DB
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Room).where(Room.code == room_code))
        db_room = res.scalar_one()
        assert db_room.is_active is True

    # 5. Disconnect Client 2 (Last client leaves -> Automatic Cleanup Triggered)
    await manager.disconnect(room_code, "sock_clean_2")

    # In-memory room and presence MUST be completely purged
    assert room_code not in manager.active_rooms
    assert room_code not in manager.room_presence
    assert "sock_clean_2" not in manager.rate_limits

    # Room MUST be marked inactive in the database
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Room).where(Room.code == room_code))
        db_room = res.scalar_one()
        assert db_room.is_active is False
        # Document MUST still be intact!
        doc_res = await db.execute(select(Document).where(Document.room_id == db_room.id))
        docs = doc_res.scalars().all()
        assert len(docs) == 1
        assert docs[0].title == "Important Persistent Doc"

    print(f"[MEMORY TEST] Memory after room eviction: {get_current_process_memory_mb():.2f} MB")

    # 6. Rejoining the inactive room restores it and re-activates in DB
    ws3 = MockWebSocket()
    await manager.connect(
        websocket=ws3,
        room_code=room_code,
        socket_id="sock_clean_3",
        user_id="user_clean_3",
        username="user3",
        role="editor"
    )

    # Re-activated in memory
    assert room_code in manager.active_rooms
    assert len(manager.active_rooms[room_code]) == 1

    # Re-activated in DB
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Room).where(Room.code == room_code))
        db_room = res.scalar_one()
        assert db_room.is_active is True

    # Clean up at test end
    await manager.disconnect(room_code, "sock_clean_3")
    assert room_code not in manager.active_rooms


@pytest.mark.asyncio
async def test_stale_connection_watchdog_cleanup():
    """Verify that unannounced socket drops or missed heartbeats get cleaned up by watchdog."""
    await init_db()
    room_code = generate_random_room_code()

    async with AsyncSessionLocal() as db:
        user_res = await db.execute(select(User).where(User.username == "watch_user"))
        user = user_res.scalar_one_or_none()
        if not user:
            user = User(username="watch_user", password_hash="dummy_hash")
            db.add(user)
            await db.commit()
            await db.refresh(user)

        room = Room(code=room_code, name="Watchdog Room", creator_id=user.id, is_active=True)
        db.add(room)
        await db.commit()

    ws = MockWebSocket()
    await manager.connect(
        websocket=ws,
        room_code=room_code,
        socket_id="stale_sock",
        user_id=user.id,
        username="stale_user",
        role="editor"
    )
    assert room_code in manager.active_rooms

    # Artificially age the connection's last_seen timestamp
    manager.active_rooms[room_code]["stale_sock"]["last_seen"] = 0.0

    # Trigger watchdog sweep with max_idle_seconds=10
    await manager.cleanup_stale_connections(max_idle_seconds=10.0)

    # Socket was closed and room was deallocated because it was empty
    assert ws.closed is True
    assert room_code not in manager.active_rooms
    assert "stale_sock" not in manager.rate_limits

    # Room in DB marked inactive
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Room).where(Room.code == room_code))
        db_room = res.scalar_one()
        assert db_room.is_active is False
