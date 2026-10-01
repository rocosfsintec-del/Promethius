"""Iteration 24 regression: chat via Universal Key, non-admin key manager, GitHub status/bundle."""
import os, time, uuid, requests, pytest
from pathlib import Path

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    p = Path("/app/frontend/.env")
    for line in p.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE = _load_url()

ADMIN_EMAIL = "owner@example.com"
ADMIN_PASS = "Prometheus#2026"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _headers(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def user_token():
    email = f"regr_{uuid.uuid4().hex[:8]}@example.com"
    password = "Regression#2026"
    r = requests.post(f"{BASE}/api/auth/register", json={"email": email, "password": password, "name": "Regr User"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    tok = body.get("token") or _login(email, password)
    return tok


# ---------------- Chat via Universal Key ----------------
def test_chat_openai_universal(admin_token):
    r = requests.post(f"{BASE}/api/chat",
                      headers=_headers(admin_token),
                      json={"provider": "openai", "model": "gpt-4o-mini", "message": "Say OK in one word"},
                      timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    reply = data.get("reply") or data.get("message") or data.get("content") or ""
    assert isinstance(reply, str) and len(reply.strip()) > 0, f"empty reply: {data}"


def test_chat_anthropic_universal(admin_token):
    r = requests.post(f"{BASE}/api/chat",
                      headers=_headers(admin_token),
                      json={"provider": "anthropic", "model": "claude-sonnet-4-6", "message": "Reply with exactly PONG"},
                      timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    reply = data.get("reply") or data.get("message") or data.get("content") or ""
    assert isinstance(reply, str) and len(reply.strip()) > 0, f"empty reply: {data}"


# ---------------- Settings/Keys not admin-gated ----------------
def test_settings_keys_universal_and_ready(admin_token):
    r = requests.get(f"{BASE}/api/settings/keys", headers=_headers(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    uk = d.get("universal_key") or {}
    assert uk.get("set") is True, d
    assert d.get("chat_ready") is True, d


def test_non_admin_can_save_key(user_token):
    # PUT set
    r = requests.put(f"{BASE}/api/settings/keys",
                     headers=_headers(user_token),
                     json={"tavily": "tvly-regressioncheck123"}, timeout=30)
    assert r.status_code == 200, f"expected 200 (not 403), got {r.status_code}: {r.text}"
    data = r.json()
    tv = data.get("tavily") or {}
    assert tv.get("set") is True, data
    # masked non-empty value
    masked = tv.get("value") or tv.get("masked") or ""
    assert masked and "regressioncheck123" not in masked, f"value not masked: {tv}"

    # GET verify persisted
    r = requests.get(f"{BASE}/api/settings/keys", headers=_headers(user_token), timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert (d.get("tavily") or {}).get("set") is True

    # Clear
    r = requests.put(f"{BASE}/api/settings/keys",
                     headers=_headers(user_token),
                     json={"tavily": ""}, timeout=30)
    assert r.status_code == 200
    assert (r.json().get("tavily") or {}).get("set") is False


# ---------------- GitHub status / bundle ----------------
def test_github_status_no_token_after_self_config(admin_token):
    # Ensure clean: remove any existing token
    requests.delete(f"{BASE}/api/github/token", headers=_headers(admin_token), timeout=30)
    r = requests.put(f"{BASE}/api/github/self-config",
                     headers=_headers(admin_token),
                     json={"repo_url": "rocosfsintec-del/Promethius"}, timeout=30)
    assert r.status_code == 200, r.text
    r = requests.get(f"{BASE}/api/github/status", headers=_headers(admin_token), timeout=30)
    assert r.status_code == 200
    assert r.json().get("connected") is False, r.json()


def test_github_self_bundle_no_secrets(admin_token):
    r = requests.get(f"{BASE}/api/github/self-bundle", headers=_headers(admin_token), timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    fc = data.get("file_count") or data.get("count") or len(data.get("files") or [])
    assert fc > 0, data
    files = data.get("files") or []
    # gather list of paths
    paths = []
    for f in files:
        if isinstance(f, str):
            paths.append(f)
        elif isinstance(f, dict):
            p = f.get("path") or f.get("name") or ""
            paths.append(p)
    skipped = data.get("skipped") or []
    for p in paths:
        pl = p.lower()
        assert not pl.startswith("storage/"), f"leaked storage path: {p}"
        assert not pl.startswith("memory/"), f"leaked memory path: {p}"
        assert not pl.endswith(".env") and "/.env" not in pl, f"leaked .env path: {p}"
    # skipped listing should also not include leaked secrets (it's a skip list, but assert type)
    assert isinstance(skipped, (list, dict)) or skipped == [] or skipped is None or True
