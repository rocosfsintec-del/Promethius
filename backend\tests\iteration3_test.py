"""
Iteration-3 backend tests for Promethius Orb-mode additions:
- GET /api/voice/voices (ElevenLabs)
- POST /api/voice/tts (audio/mpeg, uses saved voice)
- PUT /api/settings { voice_id } persists to /api/auth/me
- POST /api/chat then auto-memory extraction via GET /api/memory (auto:true)
- Regression: default Anthropic claude-sonnet-4-6 still replies
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASSWORD = "Fire2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------- Voice endpoints --------------------------------------------------

def test_voice_voices_returns_nonempty(session):
    r = session.get(f"{BASE_URL}/api/voice/voices")
    assert r.status_code == 200
    data = r.json()
    assert "voices" in data
    assert isinstance(data["voices"], list)
    assert len(data["voices"]) > 0, "ElevenLabs voice list empty"
    v0 = data["voices"][0]
    assert "id" in v0 and "name" in v0
    assert isinstance(v0["id"], str) and len(v0["id"]) > 4


def test_put_settings_persists_voice_and_me_reflects(session):
    # pick a voice from ElevenLabs list
    voices = session.get(f"{BASE_URL}/api/voice/voices").json()["voices"]
    chosen = voices[1]["id"] if len(voices) > 1 else voices[0]["id"]

    r = session.put(f"{BASE_URL}/api/settings", json={"voice_id": chosen})
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("voice_id") == chosen

    me = session.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200
    assert me.json().get("voice_id") == chosen


def test_voice_tts_returns_audio_mpeg(session):
    # Make sure a voice is set first (uses persisted voice)
    r = session.post(f"{BASE_URL}/api/voice/tts",
                     json={"text": "Promethius online."})
    assert r.status_code == 200, f"tts failed: {r.status_code} {r.text[:200]}"
    ctype = r.headers.get("content-type", "")
    assert "audio" in ctype, f"unexpected content-type {ctype}"
    assert len(r.content) > 1000, "audio body suspiciously small"


# ---------- Auto long-term memory -------------------------------------------

def test_auto_memory_extracts_durable_facts(session):
    # snapshot pre-existing memory ids
    before = session.get(f"{BASE_URL}/api/memory").json()
    before_ids = {m["id"] for m in before}

    fact_msg = ("My name is Marcus Aurelius Testus and I am a professional "
                "astrophysicist who loves astronomy. I prefer extremely "
                "concise answers, no fluff.")
    r = session.post(f"{BASE_URL}/api/chat", json={
        "message": fact_msg,
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
    })
    assert r.status_code == 200, f"chat failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert isinstance(body.get("reply"), str) and len(body["reply"]) > 0
    assert body.get("conversation_id")

    # auto-memory is fire-and-forget background task
    new_auto = []
    for _ in range(12):  # up to ~24s
        time.sleep(2)
        cur = session.get(f"{BASE_URL}/api/memory").json()
        new_auto = [m for m in cur
                    if m["id"] not in before_ids and m.get("auto") is True]
        if new_auto:
            break

    assert new_auto, "no auto-extracted memory entries appeared within 24s"

    blob = " ".join(m["content"].lower() for m in new_auto)
    # at least one durable fact about identity / astronomy / conciseness
    keywords = ["marcus", "astronom", "astrophys", "concise"]
    assert any(k in blob for k in keywords), \
        f"auto-memory didn't capture durable fact. Got: {[m['content'] for m in new_auto]}"

    # cleanup
    for m in new_auto:
        session.delete(f"{BASE_URL}/api/memory/{m['id']}")


# ---------- Regression: default chat ----------------------------------------

def test_default_anthropic_chat_replies(session):
    r = session.post(f"{BASE_URL}/api/chat", json={
        "message": "Reply with the single word: pong",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
    })
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("reply"), str)
    assert len(body["reply"].strip()) > 0
