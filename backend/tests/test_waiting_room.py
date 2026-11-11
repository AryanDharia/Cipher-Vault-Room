import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.database.models import User, Room, RoomMember, WaitingRoomRequest
from app.auth.security import hash_password, create_access_token

@pytest.mark.asyncio
async def test_waiting_room_flow_for_kicked_and_new_users():
    """
    Test Waiting Room workflow:
    1. Host creates a room.
    2. Member joins and gets kicked by host.
    3. Kicked user is blocked from rejoining directly.
    4. Kicked user submits a re-entry request.
    5. Duplicate pending request is rejected.
    6. Non-host cannot view or approve requests.
    7. Host views Waiting Room and approves request.
    8. Approved user can successfully rejoin with room code.
    """
    await init_db()
    client = TestClient(app)

    # 1. Create host and member
    host_name = f"host_{uuid.uuid4().hex[:6]}"
    user_name = f"user_{uuid.uuid4().hex[:6]}"
    cohost_name = f"cohost_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        member_user = User(username=user_name, password_hash=hash_password("pw123"), role="user")
        cohost_user = User(username=cohost_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, member_user, cohost_user])
        await db.commit()
        await db.refresh(host)
        await db.refresh(member_user)
        await db.refresh(cohost_user)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}

    member_token = create_access_token({"sub": member_user.id, "username": member_user.username, "role": member_user.role})
    member_headers = {"Authorization": f"Bearer {member_token}"}

    cohost_token = create_access_token({"sub": cohost_user.id, "username": cohost_user.username, "role": cohost_user.role})
    cohost_headers = {"Authorization": f"Bearer {cohost_token}"}

    # 2. Host creates room
    res = client.post("/api/rooms", json={"name": "Secure Enclave", "num_hosts": 2, "max_members": 10}, headers=host_headers)
    assert res.status_code == 201
    room_code = res.json()["room"]["code"]

    # 3. Co-host and member join room
    res = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=cohost_headers)
    assert res.status_code == 200

    # Promote cohost
    res = client.patch(f"/api/rooms/{room_code}/members/{cohost_user.id}/role", json={"role": "co_host"}, headers=host_headers)
    assert res.status_code == 200

    res = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=member_headers)
    assert res.status_code == 200

    # 4. Host kicks member
    res = client.post(f"/api/rooms/{room_code}/members/{member_user.id}/kick", json={"reason": "Security protocol breach"}, headers=host_headers)
    assert res.status_code == 200

    # 5. Kicked member tries to join directly -> 403 Forbidden
    res = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=member_headers)
    assert res.status_code == 403
    assert "removed from this room by the host" in res.json()["detail"]

    # 6. Kicked member submits re-entry request
    res = client.post(f"/api/rooms/{room_code}/join-request", json={"request_type": "reentry"}, headers=member_headers)
    assert res.status_code == 200
    req_data = res.json()
    assert req_data["status"] == "pending"
    assert req_data["request_type"] == "reentry"
    req_id = req_data["request_id"]

    # 7. Check duplicate prevention
    res_dup = client.post(f"/api/rooms/{room_code}/join-request", json={"request_type": "reentry"}, headers=member_headers)
    assert res_dup.status_code == 400
    assert "already pending" in res_dup.json()["detail"]

    # 8. Member checks own request status
    res_status = client.get(f"/api/rooms/{room_code}/join-request/status", headers=member_headers)
    assert res_status.status_code == 200
    assert res_status.json()["has_request"] is True
    assert res_status.json()["status"] == "pending"

    # 9. Ordinary member cannot view waiting room
    # (Create 4th ordinary user)
    anon_user = User(username=f"anon_{uuid.uuid4().hex[:6]}", password_hash=hash_password("pw123"), role="user")
    async with AsyncSessionLocal() as db:
        db.add(anon_user)
        await db.commit()
        await db.refresh(anon_user)
    anon_token = create_access_token({"sub": anon_user.id, "username": anon_user.username, "role": anon_user.role})
    anon_headers = {"Authorization": f"Bearer {anon_token}"}

    # Anon is not in room -> 404/403
    res_unauth = client.get(f"/api/rooms/{room_code}/join-requests", headers=anon_headers)
    assert res_unauth.status_code in (403, 404)

    # 10. Co-host views waiting room
    res_wr = client.get(f"/api/rooms/{room_code}/join-requests", headers=cohost_headers)
    assert res_wr.status_code == 200
    requests = res_wr.json()["requests"]
    assert len(requests) >= 1
    target_req = next((r for r in requests if r["id"] == req_id), None)
    assert target_req is not None
    assert target_req["username"] == member_user.username
    assert target_req["request_type"] == "reentry"
    assert target_req["status"] == "pending"

    # 11. Co-host approves request
    res_appr = client.post(f"/api/rooms/{room_code}/join-requests/{req_id}/approve", headers=cohost_headers)
    assert res_appr.status_code == 200
    assert res_appr.json()["new_status"] == "approved"

    # 12. Cannot re-approve processed request (replay prevention)
    res_reappr = client.post(f"/api/rooms/{room_code}/join-requests/{req_id}/approve", headers=host_headers)
    assert res_reappr.status_code == 400

    # 13. Member checks status again
    res_status2 = client.get(f"/api/rooms/{room_code}/join-request/status", headers=member_headers)
    assert res_status2.json()["status"] == "approved"

    # 14. Approved member can now successfully rejoin with room code
    res_rejoin = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=member_headers)
    assert res_rejoin.status_code == 200
    assert res_rejoin.json()["membership"]["role"] == "editor"

@pytest.mark.asyncio
async def test_waiting_room_rejection_flow():
    """
    Test that a rejected request keeps the user blocked.
    """
    await init_db()
    client = TestClient(app)

    host_name = f"host_{uuid.uuid4().hex[:6]}"
    user_name = f"user_{uuid.uuid4().hex[:6]}"

    async with AsyncSessionLocal() as db:
        host = User(username=host_name, password_hash=hash_password("pw123"), role="user")
        member_user = User(username=user_name, password_hash=hash_password("pw123"), role="user")
        db.add_all([host, member_user])
        await db.commit()
        await db.refresh(host)
        await db.refresh(member_user)

    host_token = create_access_token({"sub": host.id, "username": host.username, "role": host.role})
    host_headers = {"Authorization": f"Bearer {host_token}"}

    member_token = create_access_token({"sub": member_user.id, "username": member_user.username, "role": member_user.role})
    member_headers = {"Authorization": f"Bearer {member_token}"}

    res = client.post("/api/rooms", json={"name": "Strict Vault", "num_hosts": 1, "max_members": 5}, headers=host_headers)
    assert res.status_code == 201
    room_code = res.json()["room"]["code"]

    # Member joins and is kicked
    client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=member_headers)
    client.post(f"/api/rooms/{room_code}/members/{member_user.id}/kick", json={"reason": "Suspicious behavior"}, headers=host_headers)

    # Member submits re-entry request
    res = client.post(f"/api/rooms/{room_code}/join-request", json={"request_type": "reentry"}, headers=member_headers)
    req_id = res.json()["request_id"]

    # Host rejects request
    res = client.post(f"/api/rooms/{room_code}/join-requests/{req_id}/reject", headers=host_headers)
    assert res.status_code == 200
    assert res.json()["new_status"] == "rejected"

    # Member is still blocked
    res = client.post("/api/rooms/join", json={"code": room_code, "role": "editor"}, headers=member_headers)
    assert res.status_code == 403
    assert "removed from this room by the host" in res.json()["detail"]
