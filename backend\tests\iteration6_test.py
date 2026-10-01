"""Iteration 6: validate /api/chat (Anthropic), /api/voice/tts (ElevenLabs), /api/voice/transcribe route exists."""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://prom-metrics.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASSWORD = "Fire2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok and isinstance(tok, str) and len(tok) > 10
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---- /api/chat (Anthropic) ----
def test_chat_anthropic_returns_reply(auth_headers):
    payload = {"provider": "anthropic", "model": "claude-sonnet-4-6",
               "message": "Say hello in 4 words."}
    r = requests.post(f"{BASE_URL}/api/chat", json=payload, headers=auth_headers, timeout=90)
    assert r.status_code == 200, f"/api/chat status={r.status_code} body={r.text[:400]}"
    data = r.json()
    assert "reply" in data and isinstance(data["reply"], str) and len(data["reply"].strip()) > 0, \
        f"empty reply: {data}"
    assert "conversation_id" in data and isinstance(data["conversation_id"], str) and len(data["conversation_id"]) > 0
    print(f"[chat] reply='{data['reply'][:120]}' conv={data['conversation_id'][:8]}")


# ---- /api/voice/tts (ElevenLabs) ----
def test_voice_tts_returns_audio_mpeg(auth_headers):
    r = requests.post(f"{BASE_URL}/api/voice/tts",
                      json={"text": "Hello, I am Promethius."},
                      headers=auth_headers, timeout=60)
    assert r.status_code == 200, f"/api/voice/tts status={r.status_code} body={r.text[:300]}"
    ctype = r.headers.get("content-type", "")
    assert "audio/mpeg" in ctype, f"unexpected content-type: {ctype}"
    body = r.content
    assert body and len(body) > 1024, f"tts body too small: {len(body)} bytes"
    # MP3/ID3 magic check (ID3 tag or 0xFF 0xFB/0xF3 frame sync)
    assert body[:3] == b"ID3" or body[0] == 0xFF, f"not MP3 magic: {body[:4].hex()}"
    print(f"[tts] {len(body)} bytes content-type={ctype}")


# ---- /api/voice/transcribe (route exists; sane response) ----
def test_voice_transcribe_route_exists(auth_headers):
    # Send tiny "audio" buffer — backend may 200 (provider responded) or 4xx/5xx (provider rejected).
    # We only need the route to exist and NOT 404.
    fake = io.BytesIO(b"\x00" * 64)
    files = {"file": ("clip.webm", fake, "audio/webm")}
    r = requests.post(f"{BASE_URL}/api/voice/transcribe", files=files,
                      headers=auth_headers, timeout=60)
    assert r.status_code != 404, "/api/voice/transcribe missing"
    assert r.status_code in (200, 400, 415, 422, 500), \
        f"unexpected status {r.status_code}: {r.text[:200]}"
    print(f"[transcribe] status={r.status_code} body[:120]={r.text[:120]}")


# ---- Auth sanity: bad password ----
def test_login_rejects_bad_password():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": "WRONG_PW"}, timeout=30)
    assert r.status_code in (400, 401, 403), f"bad-pw should fail, got {r.status_code}"


# ---- /api/chat requires auth ----
def test_chat_requires_auth():
    r = requests.post(f"{BASE_URL}/api/chat",
                      json={"provider": "anthropic", "model": "claude-sonnet-4-6", "message": "hi"}, timeout=30)
    assert r.status_code in (401, 403), f"unauth chat should be 401/403, got {r.status_code}"
