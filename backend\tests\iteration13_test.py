"""Iteration 13: auto-research + small-talk + explicit web search + regressions."""
import os
import pytest
import requests
from pathlib import Path

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
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def test_api_root():
    r = requests.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code == 200
    assert "Promethius" in r.json().get("message", "")


def test_auto_research_factual_question(auth_headers):
    """Factual question with no use_web_search flag — should trigger Tavily automatically."""
    r = requests.post(
        f"{BASE_URL}/api/chat",
        headers=auth_headers,
        json={
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "message": "What is the latest version of Python and when was it released?",
        },
        timeout=90,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    reply = body.get("reply", "")
    assert isinstance(reply, str) and len(reply.strip()) > 20, f"empty/short reply: {reply!r}"
    # Reply should mention Python and a version number (research-informed content)
    low = reply.lower()
    assert "python" in low, f"reply doesn't mention python: {reply[:200]}"


def test_smalltalk_does_not_fail(auth_headers):
    """'hello there' should NOT force research but still reply 200."""
    r = requests.post(
        f"{BASE_URL}/api/chat",
        headers=auth_headers,
        json={"provider": "anthropic", "model": "claude-sonnet-4-6", "message": "hello there"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    reply = r.json().get("reply", "")
    assert isinstance(reply, str) and len(reply.strip()) > 0, f"empty reply: {reply!r}"


def test_explicit_web_search(auth_headers):
    """use_web_search=true should also return 200 non-empty reply."""
    r = requests.post(
        f"{BASE_URL}/api/chat",
        headers=auth_headers,
        json={
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "message": "current weather in Tokyo",
            "use_web_search": True,
        },
        timeout=90,
    )
    assert r.status_code == 200, r.text
    reply = r.json().get("reply", "")
    assert isinstance(reply, str) and len(reply.strip()) > 0
    assert "tokyo" in reply.lower() or "japan" in reply.lower() or "weather" in reply.lower()


def test_voice_tts(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/voice/tts",
        headers=auth_headers,
        json={"text": "Promethius online."},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    assert "audio/mpeg" in r.headers.get("content-type", "")
    assert len(r.content) > 500


# ---- Heuristic unit-style checks (validate should_auto_research directly) ----
def test_should_auto_research_heuristic():
    import sys
    sys.path.insert(0, "/app/backend")
    from server import should_auto_research
    # Factual/curious triggers
    assert should_auto_research("What is the latest version of Python?") is True
    assert should_auto_research("who won the world cup in 2026") is True
    assert should_auto_research("current weather in Tokyo") is True
    # Small-talk should NOT trigger
    assert should_auto_research("hello there") is False
    assert should_auto_research("hi") is False
    assert should_auto_research("thanks") is False
    assert should_auto_research("standby") is False
