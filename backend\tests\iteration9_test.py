"""Iteration 9 backend regression: auth + chat + TTS + PWA assets served at site root."""
import os
import pytest
import requests
from pathlib import Path

# Load REACT_APP_BACKEND_URL from /app/frontend/.env if not already in env
if "REACT_APP_BACKEND_URL" not in os.environ:
    env_file = Path("/app/frontend/.env")
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip()
                break

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@promethius.ai", "password": "Fire2026!"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---- API regression ----
def test_api_root():
    r = requests.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code == 200
    assert "Promethius" in r.json().get("message", "")


def test_chat_anthropic(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/chat",
        headers=auth_headers,
        json={
            "message": "Reply with exactly one word: ack",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
        },
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    reply = body.get("reply") or body.get("content") or body.get("message") or ""
    if isinstance(reply, dict):
        reply = reply.get("content", "")
    assert isinstance(reply, str) and len(reply.strip()) > 0, f"Empty reply: {body}"


def test_voice_tts(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/voice/tts",
        headers=auth_headers,
        json={"text": "Promethius online."},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    ctype = r.headers.get("content-type", "")
    assert "audio/mpeg" in ctype, f"unexpected content-type: {ctype}"
    assert len(r.content) > 500, f"TTS payload too small: {len(r.content)}"


# ---- PWA assets at site root ----
def _get(url):
    return requests.get(url, timeout=20, allow_redirects=True)


def test_manifest_json():
    r = _get(f"{BASE_URL}/manifest.json")
    assert r.status_code == 200
    ctype = r.headers.get("content-type", "")
    # CRA dev server may serve as application/json or application/manifest+json
    assert "json" in ctype.lower(), f"manifest content-type: {ctype}"
    data = r.json()
    assert data.get("name", "").startswith("Promethius") or data.get("short_name") == "Promethius"
    icons = data.get("icons", [])
    assert any(i.get("sizes", "").startswith("512") for i in icons)


def test_service_worker_js():
    r = _get(f"{BASE_URL}/service-worker.js")
    assert r.status_code == 200
    ctype = r.headers.get("content-type", "")
    assert "javascript" in ctype.lower(), f"sw content-type: {ctype}"
    body = r.text
    assert "promethius" in body.lower()
    assert "/api/" in body  # confirms it skips /api


def test_favicon():
    r = _get(f"{BASE_URL}/favicon.ico")
    assert r.status_code == 200
    assert len(r.content) > 100


def test_icon_192():
    r = _get(f"{BASE_URL}/promethius-192.png")
    assert r.status_code == 200
    assert r.content[:8].startswith(b"\x89PNG")


def test_icon_512():
    r = _get(f"{BASE_URL}/promethius-512.png")
    assert r.status_code == 200
    assert r.content[:8].startswith(b"\x89PNG")
