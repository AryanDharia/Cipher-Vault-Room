import pytest
import pytest_asyncio
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.database.models import User, Room, RoomMember, WaitingRoomRequest
from app.auth.security import hash_password, create_access_token

@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    await init_db()

@pytest.mark.asyncio
async def test_scenario_1_room_with_admission_approval_enabled():
    """
    Test 1: Room with admission approval enabled
    -> Guest B attempts join -> remains outside with 403 pending admission
    -> Host A sees request in Waiting Room (request_type='join', membership_status='none')
    -> Host A approves
    -> Guest B completes join successfully.
    """
    client = TestClient(app)

    host_name = f"host_{uuid.uuid4().hex[:6]}"
    guest_name = f"guest_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        guest = User(username=guest_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, guest])
        await db.commit()
        await db.refresh(host)
        await db.refresh(guest)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}
    guest_token = create_access_token({"sub": guest.id, "username": guest.username, "role": guest.role})
    guest_headers = {"Authorization": f"Bearer {guest_token}"}

    # Host creates room with require_admission_approval=True
    create_res = client.post("/api/rooms", json={
        "name": "Admission Guarded Vault",
        "num_hosts": 1,
        "max_members": 10,
        "require_admission_approval": True
    }, headers=host_headers)
    assert create_res.status_code == 201
    room_code = create_res.json()["room"]["code"]
    assert create_res.json()["room"]["require_admission_approval"] is True

    # Guest B attempts join directly -> remains outside (403 Forbidden with pending admission)
    join_res = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_headers)
    assert join_res.status_code == 403
    assert "Host approval is required" in join_res.json()["detail"]

    # Guest B checks request status
    status_res = client.get(f"/api/rooms/{room_code}/join-request/status", headers=guest_headers)
    assert status_res.status_code == 200
    assert status_res.json()["has_request"] is True
    assert status_res.json()["status"] == "pending"
    assert status_res.json()["request_type"] == "join"
    req_id = status_res.json()["id"]

    # Host A sees request in Waiting Room
    wr_res = client.get(f"/api/rooms/{room_code}/join-requests", headers=host_headers)
    assert wr_res.status_code == 200
    requests = wr_res.json()["requests"]
    assert len(requests) >= 1
    req_item = next(r for r in requests if r["id"] == req_id)
    assert req_item["username"] == guest.username
    assert req_item["request_type"] == "join"
    assert req_item["status"] == "pending"
    assert req_item["membership_status"] == "none"

    # Host A approves request
    appr_res = client.post(f"/api/rooms/{room_code}/join-requests/{req_id}/approve", headers=host_headers)
    assert appr_res.status_code == 200
    assert appr_res.json()["new_status"] == "approved"

    # Guest B checks status -> approved
    status_res2 = client.get(f"/api/rooms/{room_code}/join-request/status", headers=guest_headers)
    assert status_res2.status_code == 200
    assert status_res2.json()["status"] == "approved"

    # Guest B completes join successfully
    join_success = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_headers)
    assert join_success.status_code == 200
    assert join_success.json()["membership"]["role"] == "editor"

@pytest.mark.asyncio
async def test_scenario_2_and_3_kicked_reentry_rejection_then_reapplication_and_approval():
    """
    Test 2 & 3:
    Test 2: Host A kicks Guest C -> Guest C attempts rejoin -> blocked -> submits re-entry request
    -> Host A sees request (request_type='reentry', membership_status='kicked') -> Host A rejects -> Guest C remains blocked.
    Test 3: Guest C submits another re-entry request -> Host A approves -> Guest C completes secure re-entry.
    """
    client = TestClient(app)

    host_name = f"host_{uuid.uuid4().hex[:6]}"
    guest_c_name = f"guest_c_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        guest_c = User(username=guest_c_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, guest_c])
        await db.commit()
        await db.refresh(host)
        await db.refresh(guest_c)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}
    guest_c_token = create_access_token({"sub": guest_c.id, "username": guest_c.username, "role": guest_c.role})
    guest_c_headers = {"Authorization": f"Bearer {guest_c_token}"}

    # Host creates room (ordinary room)
    res = client.post("/api/rooms", json={"name": "Audit Enclave", "num_hosts": 1, "max_members": 5}, headers=host_headers)
    assert res.status_code == 201
    room_code = res.json()["room"]["code"]

    # Guest C joins room normally
    join1 = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_c_headers)
    assert join1.status_code == 200

    # Host kicks Guest C
    kick_res = client.post(f"/api/rooms/{room_code}/members/{guest_c.id}/kick", json={"reason": "Security violation"}, headers=host_headers)
    assert kick_res.status_code == 200

    # Test 2: Guest C attempts to rejoin directly -> blocked with kicked message
    join_blocked = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_c_headers)
    assert join_blocked.status_code == 403
    assert "removed from this room by the host" in join_blocked.json()["detail"]

    # Guest C submits re-entry request
    reentry1 = client.post(f"/api/rooms/{room_code}/join-request", json={"request_type": "reentry"}, headers=guest_c_headers)
    assert reentry1.status_code == 200
    req_id_1 = reentry1.json()["request_id"]
    assert reentry1.json()["request_type"] == "reentry"

    # Host sees request with membership_status='kicked'
    wr_res = client.get(f"/api/rooms/{room_code}/join-requests", headers=host_headers)
    assert wr_res.status_code == 200
    req_item = next(r for r in wr_res.json()["requests"] if r["id"] == req_id_1)
    assert req_item["membership_status"] == "kicked"
    assert req_item["request_type"] == "reentry"

    # Host rejects request
    rej_res = client.post(f"/api/rooms/{room_code}/join-requests/{req_id_1}/reject", headers=host_headers)
    assert rej_res.status_code == 200
    assert rej_res.json()["new_status"] == "rejected"

    # Guest C remains blocked
    join_still_blocked = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_c_headers)
    assert join_still_blocked.status_code == 403

    # Test 3: Guest C submits ANOTHER re-entry request
    reentry2 = client.post(f"/api/rooms/{room_code}/join-request", json={"request_type": "reentry"}, headers=guest_c_headers)
    assert reentry2.status_code == 200
    req_id_2 = reentry2.json()["request_id"]
    assert req_id_2 != req_id_1

    # Host A approves request 2
    appr_res2 = client.post(f"/api/rooms/{room_code}/join-requests/{req_id_2}/approve", headers=host_headers)
    assert appr_res2.status_code == 200
    assert appr_res2.json()["new_status"] == "approved"

    # Guest C completes secure re-entry
    rejoin_success = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_c_headers)
    assert rejoin_success.status_code == 200
    assert rejoin_success.json()["membership"]["role"] == "editor"

@pytest.mark.asyncio
async def test_scenario_4_and_5_host_refresh_and_reconnection_persistence():
    """
    Test 4 & 5:
    Test 4: Host browser refresh -> pending requests still visible.
    Test 5: Reconnection / multi-fetch restores pending requests without duplicates.
    """
    client = TestClient(app)

    host_name = f"host_{uuid.uuid4().hex[:6]}"
    guest_name = f"guest_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        guest = User(username=guest_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, guest])
        await db.commit()
        await db.refresh(host)
        await db.refresh(guest)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}
    guest_token = create_access_token({"sub": guest.id, "username": guest.username, "role": guest.role})
    guest_headers = {"Authorization": f"Bearer {guest_token}"}

    create_res = client.post("/api/rooms", json={"name": "Persist Vault", "num_hosts": 1, "require_admission_approval": True}, headers=host_headers)
    room_code = create_res.json()["room"]["code"]

    # Guest triggers admission request
    client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_headers)

    # First fetch (e.g. initial view)
    wr1 = client.get(f"/api/rooms/{room_code}/join-requests", headers=host_headers)
    assert wr1.status_code == 200
    reqs1 = wr1.json()["requests"]
    assert len(reqs1) == 1
    orig_id = reqs1[0]["id"]

    # Test 4: Host browser refresh (simulated by secondary client call)
    wr2 = client.get(f"/api/rooms/{room_code}/join-requests", headers=host_headers)
    assert wr2.status_code == 200
    reqs2 = wr2.json()["requests"]
    assert len(reqs2) == 1
    assert reqs2[0]["id"] == orig_id
    assert reqs2[0]["status"] == "pending"

    # Test 5: Reconnection / subsequent query does not duplicate or alter state
    wr3 = client.get(f"/api/rooms/{room_code}/join-requests", headers=host_headers)
    assert wr3.status_code == 200
    reqs3 = wr3.json()["requests"]
    assert len(reqs3) == 1
    assert reqs3[0]["id"] == orig_id

@pytest.mark.asyncio
async def test_scenario_6_non_host_approval_rejected():
    """
    Test 6: Non-host attempts approval -> backend rejects with 403 Forbidden.
    """
    client = TestClient(app)

    host_name = f"host_{uuid.uuid4().hex[:6]}"
    regular_name = f"reg_{uuid.uuid4().hex[:6]}"
    guest_name = f"guest_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        regular = User(username=regular_name, password_hash=hash_password("pw123"), role="user")
        guest = User(username=guest_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, regular, guest])
        await db.commit()
        await db.refresh(host)
        await db.refresh(regular)
        await db.refresh(guest)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}
    regular_token = create_access_token({"sub": regular.id, "username": regular.username, "role": regular.role})
    regular_headers = {"Authorization": f"Bearer {regular_token}"}
    guest_token = create_access_token({"sub": guest.id, "username": guest.username, "role": guest.role})
    guest_headers = {"Authorization": f"Bearer {guest_token}"}

    create_res = client.post("/api/rooms", json={"name": "Auth Guarded Vault", "num_hosts": 1}, headers=host_headers)
    room_code = create_res.json()["room"]["code"]

    # Regular member joins room as editor
    reg_join = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=regular_headers)
    assert reg_join.status_code == 200

    # Enable admission approval via settings
    patch_res = client.patch(f"/api/rooms/{room_code}/settings", json={"require_admission_approval": True}, headers=host_headers)
    assert patch_res.status_code == 200

    # Guest attempts join -> pending
    client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_headers)
    status_res = client.get(f"/api/rooms/{room_code}/join-request/status", headers=guest_headers)
    req_id = status_res.json()["id"]

    # Regular member tries to view waiting room -> 403 Forbidden
    reg_view = client.get(f"/api/rooms/{room_code}/join-requests", headers=regular_headers)
    assert reg_view.status_code == 403
    assert "Only the room host and co-hosts" in reg_view.json()["detail"]

    # Regular member tries to approve request -> 403 Forbidden
    reg_appr = client.post(f"/api/rooms/{room_code}/join-requests/{req_id}/approve", headers=regular_headers)
    assert reg_appr.status_code == 403
    assert "Only the room host and co-hosts" in reg_appr.json()["detail"]

@pytest.mark.asyncio
async def test_scenario_7_admission_approval_disabled_ordinary_join():
    """
    Test 7: Room with admission approval disabled -> ordinary room joining works directly.
    """
    client = TestClient(app)

    host_name = f"host_{uuid.uuid4().hex[:6]}"
    guest_name = f"guest_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        guest = User(username=guest_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, guest])
        await db.commit()
        await db.refresh(host)
        await db.refresh(guest)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}
    guest_token = create_access_token({"sub": guest.id, "username": guest.username, "role": guest.role})
    guest_headers = {"Authorization": f"Bearer {guest_token}"}

    create_res = client.post("/api/rooms", json={"name": "Open Vault", "require_admission_approval": False}, headers=host_headers)
    assert create_res.status_code == 201
    room_code = create_res.json()["room"]["code"]

    # Guest joins directly without any waiting room intervention
    join_res = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=guest_headers)
    assert join_res.status_code == 200
    assert join_res.json()["membership"]["role"] == "editor"
