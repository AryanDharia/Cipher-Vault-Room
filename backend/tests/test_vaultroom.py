import pytest
import pytest_asyncio
import json
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import init_db
from app.rooms.service import generate_random_room_code, ROOM_CODE_ALPHABET, normalize_room_code
from app.auth.security import hash_password, verify_password, create_access_token, decode_access_token
from app.ai.anomaly_detector import anomaly_detector
from app.heist.simulator import HeistSimulator

@pytest.fixture(scope="session", autouse=True)
def anyio_backend():
    return "asyncio"

@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()

@pytest.mark.asyncio
async def test_room_code_generation():
    """Verify cryptographically generated room codes are 6 chars and from unambiguous alphabet."""
    codes = set()
    for _ in range(500):
        code = generate_random_room_code()
        assert len(code) == 6
        assert all(c in ROOM_CODE_ALPHABET for c in code)
        # Verify no ambiguous chars (0, O, 1, I)
        assert "0" not in code and "O" not in code
        assert "1" not in code and "I" not in code
        codes.add(code)
    # Check uniqueness across 500 random generations (high entropy)
    assert len(codes) >= 495

@pytest.mark.asyncio
async def test_normalize_room_code():
    assert normalize_room_code("ab-c8_9k") == "ABC89K"
    assert normalize_room_code(" xyz 789 ") == "XYZ789"
    assert normalize_room_code("") == ""

@pytest.mark.asyncio
async def test_argon2id_hashing():
    pw = "SuperSecretVaultPass123!"
    hashed = hash_password(pw)
    assert hashed != pw
    assert verify_password(pw, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False

@pytest.mark.asyncio
async def test_jwt_token_flow():
    payload = {"sub": "user-uuid-1234", "username": "alice", "role": "key_holder"}
    token = create_access_token(payload)
    decoded = decode_access_token(token)
    assert decoded is not None
    assert decoded["sub"] == "user-uuid-1234"
    assert decoded["username"] == "alice"
    assert decoded["role"] == "key_holder"
    assert "exp" in decoded

@pytest.mark.asyncio
async def test_full_auth_and_room_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        import uuid
        uid = uuid.uuid4().hex[:6]
        # 1. Register User 1 (Alice)
        u1_res = await client.post("/api/auth/register", json={
            "username": f"alice_{uid}",
            "email": f"alice_{uid}@example.com",
            "password": "Password123!"
        })
        assert u1_res.status_code == 200
        alice_token = u1_res.json()["access_token"]
        alice_headers = {"Authorization": f"Bearer {alice_token}"}

        # 2. Register User 2 (Bob)
        u2_res = await client.post("/api/auth/register", json={
            "username": f"bob_{uid}",
            "email": f"bob_{uid}@example.com",
            "password": "Password123!"
        })
        assert u2_res.status_code == 200
        bob_token = u2_res.json()["access_token"]
        bob_headers = {"Authorization": f"Bearer {bob_token}"}

        # 3. Alice creates a Room (2-of-3 threshold)
        create_res = await client.post("/api/rooms", json={
            "name": "Project Alpha Vault",
            "threshold_required": 2,
            "threshold_total": 3
        }, headers=alice_headers)
        assert create_res.status_code == 201
        room_data = create_res.json()
        room_code = room_data["code"]
        assert len(room_code) == 6
        assert room_data["threshold_required"] == 2

        # 4. Bob joins the Room
        join_res = await client.post("/api/rooms/join", json={
            "code": room_code,
            "role": "editor"
        }, headers=bob_headers)
        assert join_res.status_code == 200
        assert join_res.json()["membership"]["role"] == "editor"

        # 5. Alice promotes Bob to key_holder
        role_res = await client.patch(
            f"/api/rooms/{room_code}/members/{join_res.json()['membership']['id']}/role",
            json={"role": "key_holder"},
            headers=alice_headers
        )
        # Note: if target_user_id is user_id:
        bob_user_id = u2_res.json()["user"]["id"]
        role_res = await client.patch(
            f"/api/rooms/{room_code}/members/{bob_user_id}/role",
            json={"role": "key_holder"},
            headers=alice_headers
        )
        assert role_res.status_code == 200

        # 6. Alice creates a Document with client-side encrypted envelope
        doc_res = await client.post(f"/api/rooms/{room_code}/documents", json={
            "title": "Confidential Architecture Spec",
            "doc_type": "document",
            "language": "markdown",
            "is_protected": True,
            "encrypted_envelope": json.dumps({
                "v": 1,
                "iv": "3a7b9c1d2e4f5a6b",
                "ciphertext": "8fbc923a4d...encrypted_payload",
                "auth_tag": "ab12cd34ef56"
            })
        }, headers=alice_headers)
        assert doc_res.status_code == 201
        doc_id = doc_res.json()["id"]

        # 7. Bob reads the Document (receives encrypted envelope, zero-knowledge server)
        get_doc_res = await client.get(f"/api/rooms/{room_code}/documents/{doc_id}", headers=bob_headers)
        assert get_doc_res.status_code == 200
        envelope = json.loads(get_doc_res.json()["encrypted_envelope"])
        assert "ciphertext" in envelope
        assert "iv" in envelope

        # 8. Export Document with Watermark Tracking
        export_res = await client.post(f"/api/rooms/{room_code}/documents/{doc_id}/export", json={
            "format": "markdown"
        }, headers=bob_headers)
        assert export_res.status_code == 200
        export_data = export_res.json()
        assert export_data["export_id"].startswith("VR-EXP-")
        assert "CONFIDENTIAL" in export_data["watermark"]
        assert f"bob_{uid}" in export_data["watermark"]

        # 9. Threshold Key Approval (2-of-3)
        appr_req = await client.post(f"/api/rooms/{room_code}/approvals", json={
            "document_id": doc_id,
            "target_resource": f"doc:{doc_id}",
            "description": "Requesting 2-of-3 threshold unlock"
        }, headers=bob_headers)
        assert appr_req.status_code == 201
        approval_id = appr_req.json()["id"]

        # Alice approves (1st vote)
        v1 = await client.post(f"/api/rooms/{room_code}/approvals/{approval_id}/vote", json={
            "decision": "approve",
            "reason": "Authorized security review"
        }, headers=alice_headers)
        assert v1.status_code == 200
        assert v1.json()["status"] == "pending"
        assert v1.json()["current_count"] == 1

        # Alice cannot double-vote
        v1_dup = await client.post(f"/api/rooms/{room_code}/approvals/{approval_id}/vote", json={
            "decision": "approve"
        }, headers=alice_headers)
        assert v1_dup.status_code == 400

        # Bob approves (2nd vote -> threshold reached -> approved!)
        v2 = await client.post(f"/api/rooms/{room_code}/approvals/{approval_id}/vote", json={
            "decision": "approve",
            "reason": "Confirmed quorum"
        }, headers=bob_headers)
        assert v2.status_code == 200
        assert v2.json()["status"] == "approved"
        assert v2.json()["current_count"] == 2

        # 10. Key Locker Secret Storage & Masking
        secret_res = await client.post(f"/api/rooms/{room_code}/vault", json={
            "name": "Stripe Production Secret Key",
            "category": "api_key",
            "encrypted_value": "ENC-CIPHERTEXT-SAMPLE-AES-GCM",
            "iv": "123456789012",
            "description": "Production billing gateway"
        }, headers=alice_headers)
        assert secret_res.status_code == 201
        secret_id = secret_res.json()["id"]

        # List secrets (verified masked)
        list_secrets = await client.get(f"/api/rooms/{room_code}/vault", headers=bob_headers)
        assert list_secrets.status_code == 200
        assert list_secrets.json()[0]["masked_preview"] == "••••••••••••••••"
        assert "ENC-CIPHERTEXT" not in json.dumps(list_secrets.json())

        # 11. Anomaly Detection evaluation (Isolation Forest)
        norm_eval = await client.post(f"/api/rooms/{room_code}/security/evaluate", json={
            "export_rate": 0,
            "auth_failures": 0,
            "request_rate": 1.2,
            "perm_changes": 0,
            "sensitive_access": 0,
            "is_simulated_demo": False
        }, headers=alice_headers)
        assert norm_eval.status_code == 200
        assert norm_eval.json()["is_anomaly"] is False
        assert norm_eval.json()["severity"] in ("info", "warning")

        # Threat burst anomaly evaluation
        threat_eval = await client.post(f"/api/rooms/{room_code}/security/evaluate", json={
            "export_rate": 50,
            "auth_failures": 12,
            "request_rate": 80.0,
            "perm_changes": 5,
            "sensitive_access": 15,
            "is_simulated_demo": True
        }, headers=alice_headers)
        assert threat_eval.status_code == 200
        assert threat_eval.json()["is_anomaly"] is True
        assert threat_eval.json()["severity"] == "critical"

        # 12. Heist Mode Simulation
        heist_res = await client.post(f"/api/rooms/{room_code}/heist/start", headers=alice_headers)
        assert heist_res.status_code == 200
        assert heist_res.json()["status"] == "simulation_active"
        assert len(heist_res.json()["timeline"]) == 6
        assert heist_res.json()["report"]["status"] == "CONTAINED_AND_VERIFIED"

        # 13. Audit Trail check (simulated events labeled, real events recorded)
        audit_res = await client.get(f"/api/rooms/{room_code}/audit", headers=alice_headers)
        assert audit_res.status_code == 200
        events = audit_res.json()
        assert len(events) >= 5
        types = [e["event_type"] for e in events]
        assert "ROOM_CREATED" in types
        assert "MEMBER_JOINED" in types
        assert "APPROVAL_VOTED" in types
