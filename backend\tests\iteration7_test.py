"""Iteration-7 regression tests: confirm /api/chat and /api/voice/tts still work
after Orb.jsx render-loop performance caps.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend/.env at runtime
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASS = "Fire2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert "token" in data and data["token"]
    return data["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# /api/chat -> Anthropic claude-sonnet-4-6
def test_chat_anthropic_returns_reply(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/chat",
        headers=auth_headers,
        json={
            "conversation_id": None,
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "message": "Say hello in exactly 4 words.",
        },
        timeout=60,
    )
    assert r.status_code == 200, f"chat failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert "reply" in body and isinstance(body["reply"], str) and body["reply"].strip()
    assert "conversation_id" in body and body["conversation_id"]


# /api/voice/tts -> audio/mpeg with non-empty body
def test_voice_tts_returns_mpeg(token):
    r = requests.post(
        f"{BASE_URL}/api/voice/tts",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"text": "Promethius online."},
        timeout=60,
    )
    assert r.status_code == 200, f"tts failed: {r.status_code} {r.text[:200]}"
    ctype = r.headers.get("content-type", "")
    assert "audio" in ctype, f"unexpected content-type: {ctype}"
    assert len(r.content) > 1000, f"audio body too small: {len(r.content)} bytes"
    # MP3 magic: either ID3 tag or 0xFF frame sync
    head = r.content[:3]
    assert head[:3] == b"ID3" or head[0] == 0xFF, f"not an MP3 frame: {head!r}"
