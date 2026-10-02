"""Iteration 26: Auto-model router backend tests.

Covers:
 - provider/model='auto' simple -> cheap model
 - provider='auto' hard coding -> strong model (not cheap)
 - manual override preserved (auto_selected=false, exact model echoed)
 - persisted provider/model/auto_selected on GET messages
 - Universal Key primary: claude-sonnet-5 works without native key
"""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "owner@example.com"
ADMIN_PASS = "Prometheus#2026"

CHEAP = {"gpt-4o-mini", "claude-haiku-4-5"}
STRONG_HINTS = ("opus", "sonnet", "gpt-5", "gpt-5.5")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _chat(H, payload):
    r = requests.post(f"{API}/chat", json=payload, headers=H, timeout=120)
    return r


def test_auto_simple_picks_cheap(H):
    r = _chat(H, {"provider": "auto", "model": "auto", "message": "what is 2+2?"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("auto_selected") is True, d
    assert d.get("provider") in ("openai", "anthropic"), d
    assert "reply" in d and isinstance(d["reply"], str) and len(d["reply"]) > 0
    # Lenient: simple ask should NOT pick a premium opus/gpt-5.5
    assert "opus" not in d["model"], f"simple ask routed to opus: {d['model']}"
    assert d["model"] not in ("gpt-5.5",), f"simple ask routed to gpt-5.5: {d['model']}"


def test_auto_hard_picks_strong(H):
    hard = ("Write a thread-safe generic LRU cache in Rust using only std, "
            "with O(1) get/put, and explain the memory ordering guarantees "
            "you rely on (Acquire/Release/SeqCst) and why Relaxed is unsafe here.")
    r = _chat(H, {"provider": "auto", "model": "auto", "message": hard})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("auto_selected") is True, d
    # Lenient: hard coding task should NOT be routed to the cheapest tier
    assert d["model"] not in CHEAP, f"hard task routed to cheap model: {d['model']}"
    assert any(h in d["model"] for h in STRONG_HINTS), f"expected strong model, got {d['model']}"


def test_manual_override_preserved(H):
    r = _chat(H, {"provider": "anthropic", "model": "claude-opus-4-8", "message": "Say hi in exactly 3 words."})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("auto_selected") is False, d
    assert d.get("provider") == "anthropic"
    assert d.get("model") == "claude-opus-4-8"


def test_persisted_auto_fields_on_messages(H):
    # send an auto chat, then fetch messages and ensure fields persisted
    r = _chat(H, {"provider": "auto", "model": "auto", "message": "say hello"})
    assert r.status_code == 200, r.text
    d = r.json()
    conv_id = d.get("conversation_id")
    assert conv_id, d
    # small delay for write
    time.sleep(0.3)
    gm = requests.get(f"{API}/conversations/{conv_id}/messages", headers=H, timeout=30)
    assert gm.status_code == 200, gm.text
    msgs = gm.json()
    assistant_msgs = [m for m in msgs if m.get("role") == "assistant"]
    assert assistant_msgs, msgs
    last = assistant_msgs[-1]
    assert "provider" in last and "model" in last, last
    assert last.get("auto_selected") is True, last
    assert last["provider"] in ("openai", "anthropic")


def test_universal_key_primary_sonnet5(H):
    r = _chat(H, {"provider": "anthropic", "model": "claude-sonnet-5",
                  "message": "Reply with the single word: pong"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("auto_selected") is False
    assert d.get("provider") == "anthropic"
    assert d.get("model") == "claude-sonnet-5"
    assert isinstance(d.get("reply"), str) and len(d["reply"]) > 0
