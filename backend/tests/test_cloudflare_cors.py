from fastapi.testclient import TestClient

from app.main import app


PAGES_ORIGIN = "https://cipher-vault-room.pages.dev"
client = TestClient(app)


def test_cloudflare_pages_login_preflight_is_explicitly_allowed():
    response = client.options(
        "/api/auth/login",
        headers={
            "Origin": PAGES_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PAGES_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_cloudflare_pages_post_reaches_login_route_without_auth_bypass():
    # Empty input exercises routing and CORS without querying users or sending
    # credentials; the login request schema should reject it with HTTP 422.
    response = client.post(
        "/api/auth/login",
        headers={"Origin": PAGES_ORIGIN},
        json={},
    )

    assert response.status_code == 422
    assert response.headers["access-control-allow-origin"] == PAGES_ORIGIN


def test_unlisted_origin_is_not_granted_cors_access():
    response = client.options(
        "/api/auth/login",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
