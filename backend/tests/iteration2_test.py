"""
Promethius iteration-2 NEW abilities tests.

Run:
    pytest /app/backend/tests/iteration2_test.py -v --tb=short \
        --junitxml=/app/test_reports/pytest/iteration2_results.xml
"""
import io
import os
import uuid
import time
import requests
import pytest

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

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASSWORD = "Fire2026!"


@pytest.fixture(scope="session")
def headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ----- Code execution -----
class TestCodeExec:
    def test_run_code_basic(self, headers):
        r = requests.post(f"{API}/tools/run-code", headers=headers,
                          json={"code": "print(2+2)"}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["stdout"].strip() == "4"
        assert body["stderr"] == ""

    def test_run_code_stderr(self, headers):
        r = requests.post(f"{API}/tools/run-code", headers=headers,
                          json={"code": "raise ValueError('boom')"}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "ValueError" in body["stderr"]

    def test_run_code_timeout(self, headers):
        r = requests.post(f"{API}/tools/run-code", headers=headers,
                          json={"code": "import time; time.sleep(30)"}, timeout=60)
        assert r.status_code == 200
        assert "timed out" in r.json()["stderr"].lower()


# ----- Deep research (Tavily + Claude) -----
class TestResearch:
    def test_research_returns_report_and_sources(self, headers):
        r = requests.post(f"{API}/tools/research", headers=headers,
                          json={"query": "what is the speed of light"}, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert isinstance(body["report"], str) and len(body["report"]) > 50
        assert isinstance(body["sources"], list) and len(body["sources"]) >= 1
        for s in body["sources"]:
            assert "url" in s and "title" in s


# ----- URL reader -----
class TestUrlReader:
    def test_read_url_example(self, headers):
        r = requests.post(f"{API}/tools/read-url", headers=headers,
                          json={"url": "https://example.com", "summarize": True}, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert "Example Domain" in body["text"] or len(body["text"]) > 0
        assert isinstance(body["summary"], str)
        assert len(body["summary"]) > 0

    def test_read_url_bad(self, headers):
        r = requests.post(f"{API}/tools/read-url", headers=headers,
                          json={"url": "http://invalid-host-zzz-xxx.local", "summarize": False},
                          timeout=30)
        assert r.status_code in (200, 400)


# ----- Data analysis (CSV) -----
class TestDataAnalysis:
    def test_analyze_csv(self, headers):
        csv = b"name,value\nA,1\nB,2\nC,3\nD,4\nE,5\n"
        files = {"file": ("TEST_data.csv", io.BytesIO(csv), "text/csv")}
        r = requests.post(f"{API}/tools/analyze-data", headers=headers, files=files, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["columns"] == ["name", "value"]
        assert len(body["preview"]) == 5
        assert body["rows"] == 5
        assert "value" in body["stats"]
        assert body["chart"]["y"] == "value"
        assert len(body["chart"]["data"]) == 5
        assert isinstance(body["insight"], str)


# ----- ElevenLabs voice -----
class TestVoice:
    def test_tts_returns_audio(self, headers):
        r = requests.post(f"{API}/voice/tts", headers=headers,
                          json={"text": "Hello fire", "voice": "21m00Tcm4Tlm"}, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.headers["content-type"].startswith("audio/")
        assert len(r.content) > 1000  # non-empty audio bytes

    def test_voices_list(self, headers):
        r = requests.get(f"{API}/voice/voices", headers=headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body["voices"], list)
        if body["voices"]:
            assert "id" in body["voices"][0] and "name" in body["voices"][0]


# ----- Video generation (fal.ai LTX-2, slow ~60-90s) -----
class TestVideo:
    @pytest.mark.timeout(200)
    def test_generate_video(self, headers):
        r = requests.post(f"{API}/video/generate", headers=headers,
                          json={"prompt": "a glowing ember floating in dark space",
                                "reference_image_urls": []}, timeout=180)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("url"), f"no url in response: {body}"
        assert body["url"].startswith("http")


# ----- Image edit (OpenAI - expected graceful 500 due to OOQ) -----
class TestImageEdit:
    def test_image_edit_graceful_error(self, headers):
        # 1x1 PNG
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff"
               b"\xff?\x00\x05\xfe\x02\xfe\xa3\x9aP\xd6\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"file": ("TEST_img.png", io.BytesIO(png), "image/png")}
        data = {"prompt": "make it red"}
        r = requests.post(f"{API}/image/edit", headers=headers, files=files, data=data, timeout=60)
        # OpenAI key is OOQ -> expect 500 with detail, not a crash.
        assert r.status_code in (200, 500), f"{r.status_code} {r.text}"
        if r.status_code == 500:
            assert "Image edit failed" in r.json().get("detail", "")


# ----- Scheduled jobs -----
class TestScheduled:
    def test_full_lifecycle(self, headers):
        # CREATE
        payload = {"title": "TEST_sched", "prompt": "Say exactly: SCHEDULED_OK", "interval_minutes": 60}
        r = requests.post(f"{API}/scheduled", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        job = r.json()
        jid = job["id"]
        assert job["title"] == "TEST_sched"
        assert job["interval_minutes"] == 60
        assert job["runs"] == []

        try:
            # LIST
            r2 = requests.get(f"{API}/scheduled", headers=headers, timeout=15)
            assert r2.status_code == 200
            assert any(j["id"] == jid for j in r2.json())

            # RUN NOW
            r3 = requests.post(f"{API}/scheduled/{jid}/run", headers=headers, timeout=180)
            assert r3.status_code == 200, f"{r3.status_code} {r3.text}"
            body3 = r3.json()
            assert isinstance(body3["runs"], list) and len(body3["runs"]) >= 1
            assert body3["runs"][0]["output"]
            assert len(body3["runs"][0]["output"]) > 0

            # GET shows last_run set + run included
            r4 = requests.get(f"{API}/scheduled", headers=headers, timeout=15)
            job_after = next(j for j in r4.json() if j["id"] == jid)
            assert job_after["last_run"] is not None
            assert len(job_after["runs"]) >= 1
        finally:
            # DELETE
            rd = requests.delete(f"{API}/scheduled/{jid}", headers=headers, timeout=15)
            assert rd.status_code == 200
            r5 = requests.get(f"{API}/scheduled", headers=headers, timeout=15)
            assert not any(j["id"] == jid for j in r5.json())
