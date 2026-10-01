"""
Promethius backend API tests.

Run:
    pytest /app/backend/tests/backend_test.py -v --tb=short \
        --junitxml=/app/test_reports/pytest/pytest_results.xml
"""
import io
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env value
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


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def regular_user():
    # create a fresh non-admin user for verifying regular flows / non-admin perms
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    password = "TestPass!2026"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "TEST User"},
        timeout=30,
    )
    assert r.status_code == 200, f"register failed {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email,
        "password": password,
        "token": data["token"],
        "user": data["user"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


# ---------- health / root ----------
def test_root_reachable():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert "Promethius" in r.json().get("message", "")


# ---------- auth ----------
class TestAuth:
    def test_login_admin(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 10

    def test_me_admin(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert body["role"] == "admin"

    def test_me_unauthenticated(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_login_invalid_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_register_non_admin_role(self, regular_user):
        # 2nd+ user must be 'user', not admin
        assert regular_user["user"]["role"] == "user"
        r = requests.get(f"{API}/auth/me", headers=regular_user["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json()["role"] == "user"

    def test_register_duplicate(self, regular_user):
        r = requests.post(
            f"{API}/auth/register",
            json={"email": regular_user["email"], "password": "x", "name": "x"},
            timeout=15,
        )
        assert r.status_code == 400


# ---------- models endpoint ----------
def test_models_lists_three_providers(admin_headers):
    r = requests.get(f"{API}/models", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    for p in ("openai", "anthropic", "ollama"):
        assert p in data and isinstance(data[p], list) and len(data[p]) > 0
    assert "claude-sonnet-4-6" in data["anthropic"]


# ---------- chat (default Anthropic) ----------
class TestChat:
    def test_chat_anthropic_default(self, regular_user):
        payload = {
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "message": "Reply with exactly the word: PONG",
        }
        r = requests.post(f"{API}/chat", headers=regular_user["headers"], json=payload, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "conversation_id" in data and data["reply"]
        assert isinstance(data["reply"], str) and len(data["reply"]) > 0
        regular_user["conv_id"] = data["conversation_id"]

    def test_conversation_persistence(self, regular_user):
        conv_id = regular_user.get("conv_id")
        assert conv_id, "previous test must have created conversation"
        r = requests.get(
            f"{API}/conversations/{conv_id}/messages",
            headers=regular_user["headers"],
            timeout=30,
        )
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 2
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles

    def test_list_conversations(self, regular_user):
        r = requests.get(f"{API}/conversations", headers=regular_user["headers"], timeout=15)
        assert r.status_code == 200
        convs = r.json()
        assert isinstance(convs, list) and len(convs) >= 1

    def test_chat_openai_error_graceful(self, regular_user):
        """OpenAI key is out of quota: must surface a clean 500 with message, not crash."""
        r = requests.post(
            f"{API}/chat",
            headers=regular_user["headers"],
            json={"provider": "openai", "model": "gpt-4o-mini", "message": "ping"},
            timeout=60,
        )
        # Either it works (unlikely) or returns 500 with detail. Must NOT be 502/raw crash.
        assert r.status_code in (200, 500), f"unexpected status {r.status_code} {r.text}"
        if r.status_code == 500:
            assert "detail" in r.json()

    def test_delete_conversation(self, regular_user):
        conv_id = regular_user.get("conv_id")
        r = requests.delete(f"{API}/conversations/{conv_id}", headers=regular_user["headers"], timeout=15)
        assert r.status_code == 200
        # verify gone
        r2 = requests.get(f"{API}/conversations/{conv_id}/messages", headers=regular_user["headers"], timeout=15)
        # endpoint returns [] for missing conv (no separate 404 check)
        assert r2.status_code == 200
        assert r2.json() == []


# ---------- personal memory ----------
class TestMemory:
    def test_memory_crud(self, regular_user):
        # add
        r = requests.post(
            f"{API}/memory",
            headers=regular_user["headers"],
            json={"content": "TEST_FACT: I love fire"},
            timeout=15,
        )
        assert r.status_code == 200
        mid = r.json()["id"]
        # list
        r2 = requests.get(f"{API}/memory", headers=regular_user["headers"], timeout=15)
        assert r2.status_code == 200
        assert any(m["id"] == mid for m in r2.json())
        # delete
        r3 = requests.delete(f"{API}/memory/{mid}", headers=regular_user["headers"], timeout=15)
        assert r3.status_code == 200
        r4 = requests.get(f"{API}/memory", headers=regular_user["headers"], timeout=15)
        assert not any(m["id"] == mid for m in r4.json())


# ---------- vault ----------
class TestVault:
    def test_note_crud(self, regular_user):
        r = requests.post(
            f"{API}/vault/note",
            headers=regular_user["headers"],
            json={"title": "TEST_Note", "content": "Hello vault"},
            timeout=15,
        )
        assert r.status_code == 200
        nid = r.json()["id"]
        r2 = requests.get(f"{API}/vault", headers=regular_user["headers"], timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        assert any(n["id"] == nid for n in body["notes"])
        r3 = requests.delete(f"{API}/vault/note/{nid}", headers=regular_user["headers"], timeout=15)
        assert r3.status_code == 200

    def test_upload_txt(self, regular_user):
        content = b"This is a TEST document for vault upload."
        files = {"file": ("TEST_upload.txt", io.BytesIO(content), "text/plain")}
        data = {"vault": "true"}
        r = requests.post(
            f"{API}/upload",
            headers=regular_user["headers"],
            files=files,
            data=data,
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["has_text"] is True
        assert body["original_filename"] == "TEST_upload.txt"


# ---------- projects + tasks ----------
class TestProjects:
    def test_project_and_task_flow(self, regular_user):
        # create project
        r = requests.post(
            f"{API}/projects",
            headers=regular_user["headers"],
            json={"name": "TEST_Project", "description": "fire test"},
            timeout=15,
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        regular_user["pid"] = pid
        # create task
        r2 = requests.post(
            f"{API}/tasks",
            headers=regular_user["headers"],
            json={"project_id": pid, "title": "Write hello", "description": "say hello"},
            timeout=15,
        )
        assert r2.status_code == 200
        tid = r2.json()["id"]
        regular_user["tid"] = tid
        # list projects
        r3 = requests.get(f"{API}/projects", headers=regular_user["headers"], timeout=15)
        assert r3.status_code == 200
        projects = r3.json()
        proj = next((p for p in projects if p["id"] == pid), None)
        assert proj is not None
        assert any(t["id"] == tid for t in proj["tasks"])

    def test_execute_task_graceful(self, regular_user):
        """execute_task uses openai/gpt-4o-mini which is OUT OF QUOTA (429).
        Must return 500 with detail message, not crash."""
        tid = regular_user.get("tid")
        assert tid
        r = requests.post(f"{API}/tasks/{tid}/execute", headers=regular_user["headers"], timeout=120)
        # If openai quota happened to refresh, 200 is ok; usually 500 with detail.
        assert r.status_code in (200, 500), f"unexpected {r.status_code} {r.text}"
        if r.status_code == 500:
            body = r.json()
            assert "detail" in body and "Execution failed" in body["detail"]


# ---------- journal ----------
class TestJournal:
    def test_journal_crud(self, regular_user):
        r = requests.post(
            f"{API}/journal",
            headers=regular_user["headers"],
            json={"content": "TEST journal entry", "mood": "fire"},
            timeout=15,
        )
        assert r.status_code == 200
        jid = r.json()["id"]
        r2 = requests.get(f"{API}/journal", headers=regular_user["headers"], timeout=15)
        assert r2.status_code == 200
        assert any(j["id"] == jid for j in r2.json())
        r3 = requests.delete(f"{API}/journal/{jid}", headers=regular_user["headers"], timeout=15)
        assert r3.status_code == 200


# ---------- search now configured (Tavily key present) ----------
def test_search_returns_results(regular_user):
    r = requests.post(
        f"{API}/search",
        headers=regular_user["headers"],
        json={"query": "what is fire"},
        timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    body = r.json()
    assert "results" in body and isinstance(body["results"], list)


# ---------- admin ----------
class TestAdmin:
    def test_admin_stats(self, admin_headers):
        r = requests.get(f"{API}/admin/stats", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("users", "conversations", "messages", "generated_images", "projects"):
            assert k in body and isinstance(body[k], int)

    def test_admin_users_table(self, admin_headers):
        r = requests.get(f"{API}/admin/users", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 1
        admin = next((u for u in users if u["email"] == ADMIN_EMAIL), None)
        assert admin is not None and admin["role"] == "admin"
        assert "conversation_count" in admin and "message_count" in admin

    def test_non_admin_forbidden(self, regular_user):
        r = requests.get(f"{API}/admin/stats", headers=regular_user["headers"], timeout=15)
        assert r.status_code == 403
        r2 = requests.get(f"{API}/admin/users", headers=regular_user["headers"], timeout=15)
        assert r2.status_code == 403


# ---------- cleanup ----------
def test_cleanup(regular_user):
    pid = regular_user.get("pid")
    if pid:
        requests.delete(f"{API}/projects/{pid}", headers=regular_user["headers"], timeout=15)
