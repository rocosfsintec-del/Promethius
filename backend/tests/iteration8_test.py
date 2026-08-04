"""
Iteration 8: Settings persistence (provider/model/orb) + chat/TTS regression.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') or \
    open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split('\n')[0].rstrip('/')

ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASSWORD = "Fire2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# --- Settings persistence ---

def test_settings_persist_provider_model_orb(auth):
    payload = {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "orb": {"color": "#22d3ee"},
    }
    r = requests.put(f"{BASE_URL}/api/settings", json=payload, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("provider") == "anthropic"
    assert body.get("model") == "claude-sonnet-4-6"
    assert body.get("orb", {}).get("color") == "#22d3ee"

    # Verify GET /auth/me reflects persisted values
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth, timeout=30)
    assert me.status_code == 200, me.text
    me_body = me.json()
    assert me_body.get("provider") == "anthropic"
    assert me_body.get("model") == "claude-sonnet-4-6"
    assert me_body.get("orb", {}).get("color") == "#22d3ee"


def test_settings_partial_update_does_not_clobber(auth):
    # Update only voice_id; provider/model/orb should remain
    r = requests.put(f"{BASE_URL}/api/settings",
                     json={"voice_id": "21m00Tcm4Tlm"}, headers=auth, timeout=30)
    assert r.status_code == 200
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth, timeout=30).json()
    assert me.get("provider") == "anthropic"
    assert me.get("model") == "claude-sonnet-4-6"
    assert me.get("orb", {}).get("color") == "#22d3ee"
    assert me.get("voice_id") == "21m00Tcm4Tlm"


# --- Chat regression (anthropic / claude-sonnet-4-6) ---

def test_chat_anthropic_returns_reply(auth):
    payload = {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "message": "Reply with exactly one short sentence acknowledging you're Promethius.",
    }
    r = requests.post(f"{BASE_URL}/api/chat", json=payload, headers=auth, timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("conversation_id"), str) and body["conversation_id"]
    assert isinstance(body.get("reply"), str) and len(body["reply"]) > 0


# --- TTS regression ---

def test_voice_tts_returns_audio(auth):
    r = requests.post(f"{BASE_URL}/api/voice/tts",
                      json={"text": "Promethius online."}, headers=auth, timeout=60)
    assert r.status_code == 200, r.text[:300]
    assert r.headers.get("content-type", "").startswith("audio/mpeg")
    assert len(r.content) > 1000  # non-trivial audio body


# --- Root health ---

def test_api_root(auth):
    r = requests.get(f"{BASE_URL}/api/", timeout=20)
    assert r.status_code == 200
    assert "Promethius" in r.text
