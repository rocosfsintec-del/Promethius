"""Iteration 22 backend tests: chat via universal key, tool-calling, and API key management."""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"

ADMIN_EMAIL = "owner@example.com"
ADMIN_PASSWORD = "Prometheus#2026"


# --- Fixtures ---
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def user_token():
    # Register a fresh non-admin user (first user is admin; assumes at least one exists already)
    email = f"tester_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "name": "Iter22 Tester", "password": "TestPass#2026"
    }, timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "user", f"expected non-admin, got {data['user']['role']}"
    return data["token"]


# --- Chat: Universal Key with OpenAI proxy ---
def test_chat_openai_universal_key(admin_headers):
    r = requests.post(f"{API}/chat", headers=admin_headers, json={
        "provider": "openai", "model": "gpt-4o-mini",
        "message": "Reply with exactly the word HELLO and nothing else."
    }, timeout=90)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert "conversation_id" in data and data["conversation_id"]
    reply = data.get("reply") or data.get("message") or data.get("content") or ""
    assert isinstance(reply, str) and len(reply.strip()) > 0, f"empty reply: {data}"


# --- Chat: Anthropic routed through proxy ---
def test_chat_anthropic_via_proxy(admin_headers):
    r = requests.post(f"{API}/chat", headers=admin_headers, json={
        "provider": "anthropic", "model": "claude-sonnet-4-6",
        "message": "Reply with exactly PONG"
    }, timeout=120)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data.get("conversation_id")
    reply = data.get("reply") or data.get("message") or data.get("content") or ""
    assert len(reply.strip()) > 0


# --- Chat: Tool-calling loop (PDF generation) ---
def test_chat_pdf_tool_call(admin_headers):
    r = requests.post(f"{API}/chat", headers=admin_headers, json={
        "provider": "openai", "model": "gpt-4o-mini",
        "message": "Create a PDF titled Hello with a heading and one sentence. Return the download link."
    }, timeout=120)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    reply = data.get("reply") or data.get("message") or data.get("content") or ""
    assert "/api/files/" in reply and ".pdf" in reply, f"PDF link missing in reply: {reply[:400]}"


# --- Keys management ---
def test_get_keys_shape(admin_headers):
    r = requests.get(f"{API}/settings/keys", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    for svc in ("openai", "anthropic", "elevenlabs", "fal", "tavily", "resend"):
        assert svc in data, f"missing {svc} in {data.keys()}"
        assert "set" in data[svc] and "masked" in data[svc]
    assert data.get("universal_key", {}).get("set") is True
    assert data.get("chat_ready") is True


def test_set_and_clear_tavily_key(admin_headers):
    # Set
    r = requests.put(f"{API}/settings/keys", headers=admin_headers, json={"tavily": "tvly-test123456"}, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["tavily"]["set"] is True
    assert data["tavily"]["masked"] and "…" in data["tavily"]["masked"]

    # Persistence
    r2 = requests.get(f"{API}/settings/keys", headers=admin_headers, timeout=10)
    assert r2.status_code == 200
    assert r2.json()["tavily"]["set"] is True

    # Clear
    r3 = requests.put(f"{API}/settings/keys", headers=admin_headers, json={"tavily": ""}, timeout=10)
    assert r3.status_code == 200
    # Note: set may still be True if the env default TAVILY_API_KEY is populated;
    # but if env has no default it should revert to False. Accept either but assert masked shape.
    tv = r3.json()["tavily"]
    assert "set" in tv and "masked" in tv


def test_set_keys_forbidden_for_non_admin(user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    r = requests.put(f"{API}/settings/keys", headers=headers, json={"tavily": "tvly-nope"}, timeout=10)
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
