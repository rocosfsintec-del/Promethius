"""
Iteration-5 tests:
  - /instruction.pdf served at frontend public URL (PDF, 200, application/pdf)
  - /install loads HTML (public, unauthenticated)
  - Regression: backend file upload+download via local-disk storage
    POST /api/upload returns url; GET that url returns identical bytes.
"""
import os
import io
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://video-genesis-25.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@promethius.ai"
ADMIN_PASSWORD = "Fire2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    return tok


# --- Static PDF served by frontend public folder ---
class TestInstallStatic:
    def test_pdf_served(self):
        r = requests.get(f"{BASE_URL}/instruction.pdf", timeout=20)
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "").lower()
        # PDFs begin with %PDF
        assert r.content[:4] == b"%PDF", f"not a PDF, starts with {r.content[:8]!r}"
        assert len(r.content) > 1000

    def test_install_route_public(self):
        # SPA route — server returns the index.html HTML shell unauthenticated.
        r = requests.get(f"{BASE_URL}/install", timeout=20)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "").lower()
        assert "html" in ct
        # The token "Promethius" should be in the SPA shell (title set in App.js)
        assert b"<div" in r.content


# --- Regression: upload + download (local disk storage) ---
class TestUploadDownload:
    def test_upload_then_download_roundtrip(self, admin_token):
        payload = b"TEST_iter5_local_disk_storage_" + os.urandom(64)
        files = {"file": ("TEST_iter5.bin", io.BytesIO(payload), "application/octet-stream")}
        r = requests.post(
            f"{BASE_URL}/api/upload",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            data={"vault": "false"},
            timeout=30,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert "url" in body, body
        url_path = body["url"]
        assert url_path.startswith("/api/files/"), url_path

        # GET the file back
        r2 = requests.get(
            f"{BASE_URL}{url_path}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert r2.status_code == 200, f"download failed: {r2.status_code} {r2.text[:300]}"
        assert r2.content == payload, "bytes mismatch on roundtrip"

    def test_upload_text_extraction_ok(self, admin_token):
        # Plain text upload should also succeed (regression on text branch)
        body = b"TEST_iter5 plain text payload for upload roundtrip."
        files = {"file": ("TEST_iter5.txt", io.BytesIO(body), "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/upload",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            data={"vault": "false"},
            timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        url_path = r.json()["url"]
        r2 = requests.get(f"{BASE_URL}{url_path}",
                          headers={"Authorization": f"Bearer {admin_token}"},
                          timeout=30)
        assert r2.status_code == 200
        assert r2.content == body
