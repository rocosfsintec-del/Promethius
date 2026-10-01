"""Iteration 4 tests: Prime Directives, Speaker recognition (enroll/identify/delete),
Per-speaker long-term memory."""
import io
import os
import math
import time
import wave
import struct
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASSWORD = "Fire2026!"


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}


def _make_wav(freq_hz: float, seconds: float = 3.0, sr: int = 16000, seed: int = 1) -> bytes:
    """Generate a deterministic mono 16-bit PCM WAV with harmonics + noise so MFCC
    produces a distinguishable embedding."""
    import random
    rnd = random.Random(seed)
    n = int(sr * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        for i in range(n):
            t = i / sr
            # carrier + 2nd & 3rd harmonics + tiny noise → richer spectrum so MFCCs differ
            s = (
                0.55 * math.sin(2 * math.pi * freq_hz * t)
                + 0.25 * math.sin(2 * math.pi * (freq_hz * 2) * t)
                + 0.15 * math.sin(2 * math.pi * (freq_hz * 3) * t)
                + 0.05 * (rnd.random() - 0.5)
            )
            v = max(-1.0, min(1.0, s))
            frames += struct.pack("<h", int(v * 30000))
        w.writeframes(bytes(frames))
    return buf.getvalue()


# ============================================================================
# Prime Directives
# ============================================================================
class TestDirectives:
    def test_default_directives_then_update_then_chat_obeys(self, H):
        # Make sure account starts clean by removing any existing directive override
        # (no DELETE endpoint — PUT a default reset is via setting empty? actually setting
        # empty content makes is_default False with empty content, so just snapshot+restore.)
        original = requests.get(f"{BASE_URL}/api/directives", headers=H, timeout=15).json()

        # 1) If a previous run left a custom directive, reset by writing default text first
        if not original.get("is_default", True):
            # we'll restore at the end; for now overwrite with default
            pass

        # Force a default state for this test by writing default content & verifying
        # the server returns is_default=True only when no doc was set.
        # We have no "delete" endpoint, so we'll just set a known custom one and verify obedience.

        custom = "Always call the user Commander. Begin every reply with the literal word Commander."
        put_resp = requests.put(f"{BASE_URL}/api/directives",
                                json={"content": custom}, headers=H, timeout=15)
        assert put_resp.status_code == 200, put_resp.text

        got = requests.get(f"{BASE_URL}/api/directives", headers=H, timeout=15).json()
        assert got["content"] == custom
        assert got["is_default"] is False

        # Chat should obey directive
        chat = requests.post(f"{BASE_URL}/api/chat", headers=H, json={
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "message": "Say hi.",
        }, timeout=120)
        assert chat.status_code == 200, chat.text
        reply = chat.json()["reply"]
        assert "commander" in reply.lower(), f"Directive not obeyed. Reply: {reply[:300]}"

        # Cleanup conversation we just created
        conv_id = chat.json()["conversation_id"]
        requests.delete(f"{BASE_URL}/api/conversations/{conv_id}", headers=H, timeout=15)

        # Restore original directives state
        if original.get("is_default", True):
            # Reset by writing the default text back — is_default flag will become False,
            # but content matches default → effectively neutral for owner.
            requests.put(f"{BASE_URL}/api/directives",
                         json={"content": original["content"]}, headers=H, timeout=15)
        else:
            requests.put(f"{BASE_URL}/api/directives",
                         json={"content": original["content"]}, headers=H, timeout=15)

    def test_fresh_user_directives_default(self):
        """A brand-new user should see is_default=true and default content."""
        email = f"TEST_dir_{int(time.time()*1000)}@promethius.ai"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "Test12345!", "name": "T"}, timeout=30)
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        d = requests.get(f"{BASE_URL}/api/directives", headers=h, timeout=15).json()
        assert d["is_default"] is True
        assert "Serve and protect" in d["content"]


# ============================================================================
# Speaker recognition
# ============================================================================
@pytest.fixture(scope="module")
def voices():
    return {
        "sarah": _make_wav(freq_hz=180.0, seed=11),       # speaker A
        "sarah2": _make_wav(freq_hz=180.0, seed=11),      # near-identical clip
        "other": _make_wav(freq_hz=420.0, seed=99),       # very different speaker
    }


class TestSpeakers:
    @pytest.fixture(autouse=True)
    def _cleanup(self, H):
        # nothing pre; cleanup post
        yield
        # Best-effort: delete any TEST speaker named Sarah created by this run
        sp = requests.get(f"{BASE_URL}/api/speakers", headers=H, timeout=15).json()
        for s in sp:
            if s.get("name", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/speakers/{s['id']}", headers=H, timeout=15)

    def test_enroll_identify_reenroll_delete_flow(self, H, voices):
        name = f"TEST_Sarah_{int(time.time())}"

        # ---- enroll Sarah
        files = {"file": ("sarah.wav", voices["sarah"], "audio/wav")}
        data = {"name": name}
        r = requests.post(f"{BASE_URL}/api/speakers/enroll",
                          headers=H, files=files, data=data, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == name
        assert "id" in body
        assert body.get("updated") in (False, None)
        sid = body["id"]

        # ---- re-enroll same name → updated:true
        files2 = {"file": ("sarah2.wav", voices["sarah2"], "audio/wav")}
        r2 = requests.post(f"{BASE_URL}/api/speakers/enroll",
                           headers=H, files=files2, data={"name": name}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("updated") is True
        assert r2.json()["id"] == sid

        # ---- identify with same-voice clip → match
        files3 = {"file": ("probe_same.wav", voices["sarah2"], "audio/wav")}
        r3 = requests.post(f"{BASE_URL}/api/speakers/identify",
                           headers=H, files=files3, timeout=30)
        assert r3.status_code == 200, r3.text
        ident = r3.json()
        assert ident["speaker"] == name, f"identify did not match enrolled speaker: {ident}"
        assert ident["score"] >= 0.88

        # ---- identify with clearly different voice → null
        files4 = {"file": ("probe_other.wav", voices["other"], "audio/wav")}
        r4 = requests.post(f"{BASE_URL}/api/speakers/identify",
                           headers=H, files=files4, timeout=30)
        assert r4.status_code == 200, r4.text
        assert r4.json()["speaker"] is None, f"identify wrongly matched: {r4.json()}"

        # ---- list shows speaker with memory_count
        sp = requests.get(f"{BASE_URL}/api/speakers", headers=H, timeout=15).json()
        assert any(s["id"] == sid and s["name"] == name and "memory_count" in s for s in sp)

        # ---- delete & verify gone
        rd = requests.delete(f"{BASE_URL}/api/speakers/{sid}", headers=H, timeout=15)
        assert rd.status_code == 200, rd.text
        sp2 = requests.get(f"{BASE_URL}/api/speakers", headers=H, timeout=15).json()
        assert not any(s["id"] == sid for s in sp2)


# ============================================================================
# Per-person memory
# ============================================================================
class TestPerPersonMemory:
    def test_speaker_tagged_memory_scope(self, H):
        speaker_name = f"TEST_Sarah_mem_{int(time.time())}"
        # Enroll synthetic Sarah so the speaker exists (not strictly required, but realistic)
        wav = _make_wav(freq_hz=220.0, seed=33)
        files = {"file": ("sarah.wav", wav, "audio/wav")}
        enroll = requests.post(f"{BASE_URL}/api/speakers/enroll",
                               headers=H, files=files, data={"name": speaker_name}, timeout=30)
        assert enroll.status_code == 200, enroll.text
        sid = enroll.json()["id"]

        # Snapshot memories
        before = requests.get(f"{BASE_URL}/api/memory", headers=H, timeout=15).json()
        before_ids = {m["id"] for m in before}

        # Speak as Sarah
        chat1 = requests.post(f"{BASE_URL}/api/chat", headers=H, json={
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "speaker": speaker_name,
            "message": "I love astronomy. I'm working on stellar parallax measurements.",
        }, timeout=120)
        assert chat1.status_code == 200, chat1.text
        conv1 = chat1.json()["conversation_id"]

        # Wait for background memory extraction
        time.sleep(8)

        mem = requests.get(f"{BASE_URL}/api/memory", headers=H, timeout=15).json()
        new = [m for m in mem if m["id"] not in before_ids]

        speaker_facts = [m for m in new if m.get("speaker") == speaker_name]
        owner_facts_new = [m for m in new if not m.get("speaker")]

        assert speaker_facts, f"No per-speaker memory tagged for {speaker_name}. New: {new}"
        joined = " ".join(m["content"].lower() for m in speaker_facts)
        assert ("astronom" in joined) or ("parallax" in joined) or ("stellar" in joined), \
            f"Speaker memory lacks topical content: {joined}"
        # Should NOT have been tagged as owner
        for m in owner_facts_new:
            assert "astronom" not in m["content"].lower(), \
                f"Owner scope leaked astronomy fact: {m}"

        # Clean up: delete speaker (removes their tagged memories) + conversation
        requests.delete(f"{BASE_URL}/api/speakers/{sid}", headers=H, timeout=15)
        requests.delete(f"{BASE_URL}/api/conversations/{conv1}", headers=H, timeout=15)
        # Also delete any stray owner-scope new memories created during this test
        for m in owner_facts_new:
            requests.delete(f"{BASE_URL}/api/memory/{m['id']}", headers=H, timeout=15)


# ============================================================================
# Regression: anthropic default chat still works
# ============================================================================
class TestChatRegression:
    def test_anthropic_chat_default(self, H):
        r = requests.post(f"{BASE_URL}/api/chat", headers=H, json={
            "provider": "anthropic", "model": "claude-sonnet-4-6",
            "message": "Reply with exactly the word: ack",
        }, timeout=120)
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("reply"), str) and len(r.json()["reply"]) > 0
        requests.delete(f"{BASE_URL}/api/conversations/{r.json()['conversation_id']}",
                        headers=H, timeout=15)
