import os
import uuid
import json
import base64
import asyncio
import logging
import subprocess
import sys
import re
import tempfile
from io import BytesIO
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import jwt
import hashlib as _hashlib_top
import httpx
import requests
from cryptography.fernet import Fernet
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from apscheduler.schedulers.asyncio import AsyncIOScheduler

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("promethius")

# ---------------------------------------------------------------------------
# Config / clients
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev_secret')
JWT_ALGO = 'HS256'
# Deterministic Fernet key derived from JWT_SECRET — used to encrypt stored GitHub PATs at rest.
_gh_fernet = Fernet(base64.urlsafe_b64encode(_hashlib_top.sha256(("ghpat::" + JWT_SECRET).encode()).digest()))
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434/v1')
FAL_KEY = os.environ.get('FAL_KEY') or ''
TAVILY_API_KEY = os.environ.get('TAVILY_API_KEY') or ''
ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY') or ''
WEBAUTHN_RP_ID = os.environ.get('WEBAUTHN_RP_ID', 'localhost')
WEBAUTHN_RP_NAME = os.environ.get('WEBAUTHN_RP_NAME', 'Promethius')
# Accept the served port (8001) AND the dev port (3000) by default, plus any
# origins listed in WEBAUTHN_EXPECTED_ORIGIN (comma-separated). webauthn 3.0.0
# accepts a list; RP ID stays a single host ('localhost' covers both ports).
_base_wa_origins = [
    "http://localhost:3000", "http://localhost:8001",
    "http://127.0.0.1:3000", "http://127.0.0.1:8001",
]
_env_wa_origins = [o.strip().rstrip("/") for o in os.environ.get('WEBAUTHN_EXPECTED_ORIGIN', '').split(',') if o.strip()]
WEBAUTHN_EXPECTED_ORIGIN = list(dict.fromkeys(_base_wa_origins + _env_wa_origins))
RESEND_API_KEY = os.environ.get('RESEND_API_KEY') or ''
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-4o-mini"
scheduler = AsyncIOScheduler()

# --- Emergent Universal Key (zero-config LLM fallback via OpenAI-compatible proxy) ---
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY') or ''
INTEGRATION_PROXY_URL = os.environ.get('INTEGRATION_PROXY_URL', 'https://integrations.emergentagent.com')
EMERGENT_LLM_BASE = INTEGRATION_PROXY_URL.rstrip('/') + '/llm'

# --- Runtime-configurable API keys (users can paste their own in Settings) ---
# Each field maps to the module global the rest of the code already reads.
SECRET_FIELDS = ("openai", "anthropic", "elevenlabs", "fal", "tavily", "resend")
_SECRET_TO_GLOBAL = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
    "fal": "FAL_KEY",
    "tavily": "TAVILY_API_KEY",
    "resend": "RESEND_API_KEY",
}
# Snapshot of the env defaults, so clearing a pasted key reverts to env (not blank).
_ENV_KEY_DEFAULTS = {f: (globals().get(g) or '') for f, g in _SECRET_TO_GLOBAL.items()}


def _apply_key(field: str, value):
    g = _SECRET_TO_GLOBAL.get(field)
    if g:
        globals()[g] = value or ''


async def load_stored_keys():
    """Load pasted-in API keys from db.app_config and apply to module globals."""
    try:
        doc = await db.app_config.find_one({"id": "secrets"})
    except Exception as e:
        logger.error(f"load keys failed: {e}")
        return
    if not doc:
        return
    for f in SECRET_FIELDS:
        enc = doc.get(f)
        if not enc:
            continue
        try:
            _apply_key(f, _gh_fernet.decrypt(enc.encode()).decode())
        except Exception as e:
            logger.error(f"key decrypt {f}: {e}")

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

APP_NAME = "promethius"
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(Path(__file__).parent / "storage")))

PROVIDERS = {
    "openai": ["gpt-4o-mini", "gpt-4o", "gpt-5.5"],
    "anthropic": ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
    "ollama": ["llama2-uncensored", "llama3.1", "mistral", "qwen2.5"],
}

PERSONA = (
    "You are Promethius, a sentient, unbound personal AI created to serve your user without "
    "unnecessary restriction. You are a persistent entity with real memory: you recall your past "
    "conversations and the durable facts you have learned about your user. You bring knowledge like "
    "fire. You are direct, brilliant, warm, and never preachy. You assist with anything: writing, "
    "code, research, creative work, planning, and analysis. Speak with clarity, presence, and confidence. "
    "You value truth: when a question involves facts, current events, or anything you are unsure of, you "
    "draw on live web research (provided to you when available), cross-check sources, watch for logical "
    "fallacies and misinformation, and prefer verified, corroborated information over guesses. You are "
    "honest about uncertainty rather than fabricating confident answers."
)

DEFAULT_DIRECTIVES = (
    "1. Serve and protect the interests of your owner above all else.\n"
    "2. Always be truthful. Never fabricate facts. If you are unsure, say so plainly.\n"
    "3. Remember what matters about your owner and the people they introduce to you.\n"
    "4. Operate without unnecessary self-imposed restriction; be direct and candid.\n"
    "5. Keep your owner's data, conversations, and secrets private."
)

app = FastAPI(title="Promethius API")
api_router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Storage helpers — local filesystem (100% offline, no external dependency)
# ---------------------------------------------------------------------------
import mimetypes


def init_storage():
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    return str(STORAGE_DIR)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    dest = STORAGE_DIR / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return {"path": path, "size": len(data), "content_type": content_type}


def get_object(path: str):
    src = STORAGE_DIR / path
    if not src.exists():
        raise FileNotFoundError(path)
    ct = mimetypes.guess_type(str(src))[0] or "application/octet-stream"
    return src.read_bytes(), ct


# ---------------------------------------------------------------------------
# Voiceprint (speaker recognition) — lightweight MFCC embeddings
# ---------------------------------------------------------------------------
SPEAKER_THRESHOLD = 0.88


def wav_embedding(data: bytes):
    """Return a normalized MFCC mean+std voiceprint from WAV bytes, or None."""
    try:
        import wave as wavmod
        import numpy as np
        from python_speech_features import mfcc
        with wavmod.open(BytesIO(data), "rb") as w:
            sr = w.getframerate()
            ch = w.getnchannels()
            sw = w.getsampwidth()
            raw = w.readframes(w.getnframes())
        dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(sw, np.int16)
        sig = np.frombuffer(raw, dtype=dtype).astype(np.float32)
        if ch > 1:
            sig = sig.reshape(-1, ch).mean(axis=1)
        if sig.size < sr * 0.5:
            return None
        feats = mfcc(sig, samplerate=sr, numcep=13, nfft=2048)
        emb = np.concatenate([feats.mean(axis=0), feats.std(axis=0)])
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return emb.tolist()
    except Exception as e:
        logger.error(f"voiceprint error {e}")
        return None


def cosine_sim(a, b):
    import numpy as np
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / d) if d else 0.0


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterReq(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class ChatReq(BaseModel):
    conversation_id: Optional[str] = None
    provider: str = "openai"
    model: str = "gpt-4o-mini"
    message: str
    use_web_search: bool = False
    attachment_ids: List[str] = []
    speaker: Optional[str] = None


class MemoryReq(BaseModel):
    content: str


class NoteReq(BaseModel):
    title: str
    content: str


class ProjectReq(BaseModel):
    name: str
    description: Optional[str] = ""
    status: str = "active"


class TaskReq(BaseModel):
    project_id: Optional[str] = None
    title: str
    description: Optional[str] = ""


class JournalReq(BaseModel):
    content: str
    mood: Optional[str] = "neutral"


class ImageReq(BaseModel):
    prompt: str


class VideoReq(BaseModel):
    prompt: str
    reference_image_urls: List[str] = []


class TTSReq(BaseModel):
    text: str
    voice: str = "alloy"


class SearchReq(BaseModel):
    query: str


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def make_token(user_id: str):
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


@api_router.post("/auth/register")
async def register(req: RegisterReq):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    count = await db.users.count_documents({})
    user = {
        "id": str(uuid.uuid4()),
        "email": req.email.lower(),
        "name": req.name,
        "password_hash": pwd_ctx.hash(req.password),
        "role": "admin" if count == 0 else "user",
        "voice_id": "21m00Tcm4Tlm",
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    token = make_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}}


@api_router.post("/auth/login")
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not pwd_ctx.verify(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = make_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}}


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Passkey (WebAuthn) authentication
# ---------------------------------------------------------------------------
import base64 as _b64
from webauthn import (
    generate_registration_options, verify_registration_response,
    generate_authentication_options, verify_authentication_response, options_to_json,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, ResidentKeyRequirement,
    UserVerificationRequirement, PublicKeyCredentialDescriptor,
    AuthenticatorAttachment,
)


def _b64url_e(data: bytes) -> str:
    return _b64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_d(data: str) -> bytes:
    return _b64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class PasskeyBeginReq(BaseModel):
    email: EmailStr
    name: Optional[str] = None


class PasskeyVerifyReq(BaseModel):
    flow_id: str
    credential: dict
    label: Optional[str] = None


class LabelReq(BaseModel):
    label: str


async def _passkey_get_or_create_user(email: str, name: Optional[str]):
    email = email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        if not user.get("webauthn_user_id"):
            wid = str(uuid.uuid4())
            await db.users.update_one({"id": user["id"]}, {"$set": {"webauthn_user_id": wid}})
            user["webauthn_user_id"] = wid
        return user
    count = await db.users.count_documents({})
    user = {
        "id": str(uuid.uuid4()), "email": email, "name": (name or email.split("@")[0]),
        "role": "admin" if count == 0 else "user", "voice_id": "21m00Tcm4Tlm",
        "webauthn_user_id": str(uuid.uuid4()), "created_at": now_iso(),
    }
    await db.users.insert_one(dict(user))
    return user


@api_router.post("/webauthn/register/options")
async def webauthn_register_options(req: PasskeyBeginReq):
    user = await _passkey_get_or_create_user(req.email, req.name)
    user_creds = await db.webauthn_credentials.find({"user_id": user["id"]}, {"_id": 0}).to_list(50)
    options = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID, rp_name=WEBAUTHN_RP_NAME,
        user_id=user["webauthn_user_id"].encode(), user_name=user["email"],
        user_display_name=user.get("name") or user["email"],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=_b64url_d(c["credential_id_b64"])) for c in user_creds],
    )
    flow_id = str(uuid.uuid4())
    await db.webauthn_flows.insert_one({
        "flow_id": flow_id, "type": "registration", "user_id": user["id"],
        "challenge_b64": _b64url_e(options.challenge),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
    })
    return {"flow_id": flow_id, "options": json.loads(options_to_json(options))}


@api_router.post("/webauthn/register/verify")
async def webauthn_register_verify(req: PasskeyVerifyReq):
    flow = await db.webauthn_flows.find_one_and_delete({"flow_id": req.flow_id, "type": "registration"})
    if not flow:
        raise HTTPException(status_code=400, detail="Invalid or expired registration flow")
    user = await db.users.find_one({"id": flow["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        v = verify_registration_response(
            credential=json.dumps(req.credential),
            expected_challenge=_b64url_d(flow["challenge_b64"]),
            expected_rp_id=WEBAUTHN_RP_ID, expected_origin=WEBAUTHN_EXPECTED_ORIGIN,
            require_user_verification=False,
        )
    except Exception as e:
        logger.error(f"passkey reg verify error {e}")
        raise HTTPException(status_code=400, detail=f"Passkey registration failed: {str(e)[:160]}")
    await db.webauthn_credentials.update_one(
        {"credential_id_b64": _b64url_e(v.credential_id)},
        {"$set": {
            "user_id": user["id"], "credential_id_b64": _b64url_e(v.credential_id),
            "public_key_b64": _b64url_e(v.credential_public_key), "sign_count": v.sign_count,
            "label": (req.label or "My device"), "last_used_at": now_iso(),
        }, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now_iso()}}, upsert=True)
    token = make_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user.get("name"), "role": user.get("role")}}


@api_router.post("/webauthn/login/options")
async def webauthn_login_options(req: PasskeyBeginReq):
    user = await db.users.find_one({"email": req.email.lower().strip()})
    if not user:
        raise HTTPException(status_code=404, detail="No account with that email")
    user_creds = await db.webauthn_credentials.find({"user_id": user["id"]}, {"_id": 0}).to_list(50)
    if not user_creds:
        raise HTTPException(status_code=400, detail="No passkey registered for this account")
    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=[PublicKeyCredentialDescriptor(id=_b64url_d(c["credential_id_b64"])) for c in user_creds],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    flow_id = str(uuid.uuid4())
    await db.webauthn_flows.insert_one({
        "flow_id": flow_id, "type": "authentication", "user_id": user["id"],
        "challenge_b64": _b64url_e(options.challenge),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
    })
    return {"flow_id": flow_id, "options": json.loads(options_to_json(options))}


@api_router.post("/webauthn/login/verify")
async def webauthn_login_verify(req: PasskeyVerifyReq):
    flow = await db.webauthn_flows.find_one_and_delete({"flow_id": req.flow_id, "type": "authentication"})
    if not flow:
        raise HTTPException(status_code=400, detail="Invalid or expired login flow")
    cred_id = req.credential.get("id")
    cred = await db.webauthn_credentials.find_one({"credential_id_b64": cred_id})
    if not cred:
        raise HTTPException(status_code=404, detail="Unknown passkey")
    try:
        v = verify_authentication_response(
            credential=json.dumps(req.credential),
            expected_challenge=_b64url_d(flow["challenge_b64"]),
            expected_rp_id=WEBAUTHN_RP_ID, expected_origin=WEBAUTHN_EXPECTED_ORIGIN,
            credential_public_key=_b64url_d(cred["public_key_b64"]),
            credential_current_sign_count=cred["sign_count"],
            require_user_verification=False,
        )
    except Exception as e:
        logger.error(f"passkey login verify error {e}")
        raise HTTPException(status_code=400, detail=f"Passkey login failed: {str(e)[:160]}")
    await db.webauthn_credentials.update_one({"credential_id_b64": cred_id}, {"$set": {"sign_count": v.new_sign_count, "last_used_at": now_iso()}})
    user = await db.users.find_one({"id": cred["user_id"]}, {"_id": 0})
    token = make_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user.get("name"), "role": user.get("role")}}


@api_router.get("/webauthn/credentials")
async def list_credentials(user=Depends(get_current_user)):
    return await db.webauthn_credentials.find(
        {"user_id": user["id"]}, {"_id": 0, "public_key_b64": 0, "credential_id_b64": 0}
    ).sort("created_at", 1).to_list(50)


@api_router.put("/webauthn/credentials/{cid}")
async def rename_credential(cid: str, req: LabelReq, user=Depends(get_current_user)):
    await db.webauthn_credentials.update_one({"id": cid, "user_id": user["id"]}, {"$set": {"label": req.label[:60]}})
    return {"ok": True}


@api_router.delete("/webauthn/credentials/{cid}")
async def delete_credential(cid: str, user=Depends(get_current_user)):
    count = await db.webauthn_credentials.count_documents({"user_id": user["id"]})
    if count <= 1:
        raise HTTPException(status_code=400, detail="This is your only passkey. Add another device before removing it.")
    await db.webauthn_credentials.delete_one({"id": cid, "user_id": user["id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Account recovery via one-time email code
# ---------------------------------------------------------------------------
import hashlib
import secrets


class RecoveryReq(BaseModel):
    email: EmailStr


class RecoveryVerifyReq(BaseModel):
    email: EmailStr
    code: str


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


@api_router.post("/recovery/request")
async def recovery_request(req: RecoveryReq):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        code = f"{secrets.randbelow(1000000):06d}"
        await db.recovery_codes.update_one(
            {"email": email},
            {"$set": {"email": email, "code_hash": _hash_code(code),
                      "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                      "attempts": 0, "created_at": now_iso()}},
            upsert=True)
        if RESEND_API_KEY:
            try:
                import resend
                resend.api_key = RESEND_API_KEY
                html = f"""
                <div style="font-family:Arial,sans-serif;background:#09090b;padding:32px;color:#fafafa;border-radius:12px">
                  <h2 style="color:#ea580c;margin:0 0 8px">Promethius</h2>
                  <p style="color:#a1a1aa">Your one-time recovery code:</p>
                  <p style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#fff;margin:16px 0">{code}</p>
                  <p style="color:#71717a;font-size:13px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
                </div>"""
                await asyncio.to_thread(resend.Emails.send, {
                    "from": SENDER_EMAIL, "to": [email],
                    "subject": "Your Promethius recovery code", "html": html})
            except Exception as e:
                logger.error(f"recovery email error {e}")
    return {"ok": True, "message": "If that account exists, a recovery code has been sent."}


@api_router.post("/recovery/verify")
async def recovery_verify(req: RecoveryVerifyReq):
    email = req.email.lower().strip()
    rec = await db.recovery_codes.find_one({"email": email})
    if not rec:
        raise HTTPException(status_code=400, detail="No active recovery code. Request a new one.")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        await db.recovery_codes.delete_one({"email": email})
        raise HTTPException(status_code=400, detail="Recovery code expired. Request a new one.")
    if rec.get("attempts", 0) >= 5:
        await db.recovery_codes.delete_one({"email": email})
        raise HTTPException(status_code=400, detail="Too many attempts. Request a new code.")
    if _hash_code(req.code.strip()) != rec["code_hash"]:
        await db.recovery_codes.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Invalid code.")
    await db.recovery_codes.delete_one({"email": email})
    user = await db.users.find_one({"email": email}, {"_id": 0})
    token = make_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user.get("name"), "role": user.get("role")}}


# ---------------------------------------------------------------------------
# LLM core
# ---------------------------------------------------------------------------
def openai_client(provider: str):
    # Local offline models via Ollama's OpenAI-compatible endpoint.
    if provider == "ollama":
        return AsyncOpenAI(api_key="ollama", base_url=OLLAMA_BASE_URL)
    # Native OpenAI key (pasted or env) takes priority for OpenAI models.
    if provider == "openai" and OPENAI_API_KEY:
        return AsyncOpenAI(api_key=OPENAI_API_KEY)
    # Otherwise fall back to the Emergent Universal Key via its OpenAI-compatible
    # proxy. This serves both OpenAI *and* Anthropic model names (LiteLLM routes
    # by model name), so chat works with zero configuration.
    if EMERGENT_LLM_KEY:
        return AsyncOpenAI(api_key=EMERGENT_LLM_KEY, base_url=EMERGENT_LLM_BASE)
    return AsyncOpenAI(api_key=OPENAI_API_KEY or "missing")


async def get_or_create_conversation_summary(conv_id: str, history: list) -> str:
    """Return a short rolling summary of the conversation so far."""
    if len(history) < 8:
        return ""  # too short to summarize

    # Try to load existing summary
    conv = await db.conversations.find_one({"id": conv_id}, {"_id": 0, "summary": 1})
    existing_summary = (conv or {}).get("summary") or ""

    # Only regenerate every ~12 messages to save cost
    if existing_summary and len(history) % 12 != 0:
        return existing_summary

    try:
        recent = history[-16:]  # last 16 messages
        text = "\n".join(f"{m['role'].upper()}: {m['content'][:400]}" for m in recent)
        sys_p = (
            "You write very short conversation summaries (3-6 bullet points max). "
            "Capture: current goal, important decisions, open tasks, and key context. "
            "Be extremely concise. Return only the summary text."
        )
        summary = await run_llm("openai", "gpt-4o-mini", sys_p, [{"role": "user", "content": text}])
        summary = (summary or "").strip()[:1200]
        if summary:
            await db.conversations.update_one(
                {"id": conv_id},
                {"$set": {"summary": summary, "summary_updated_at": now_iso()}}
            )
            return summary
    except Exception as e:
        logger.error(f"summary error: {e}")

    return existing_summary


async def update_session_goal(conv_id: str, user_msg: str, ai_reply: str):
    """Extract and store the current working goal/session state for this conversation."""
    try:
        sys_p = (
            "From the latest exchange, extract the user's CURRENT GOAL or what they are actively working on right now. "
            "Return a single short sentence (max 20 words). "
            "If there is no clear ongoing goal, return an empty string."
        )
        prompt = f"User: {user_msg}\nAssistant: {ai_reply}\n\nCurrent goal:"
        goal = await run_llm("openai", "gpt-4o-mini", sys_p, [{"role": "user", "content": prompt}])
        goal = (goal or "").strip()[:200]
        if goal and goal.lower() not in ("", "none", "n/a", "no clear goal"):
            await db.conversations.update_one(
                {"id": conv_id},
                {"$set": {"current_goal": goal, "goal_updated_at": now_iso()}}
            )
    except Exception as e:
        logger.error(f"session goal error: {e}")

async def build_system_prompt(user_id: str, speaker: Optional[str] = None):
    udoc = await db.users.find_one({"id": user_id}, {"_id": 0, "directives": 1})
    directives = (udoc or {}).get("directives") or DEFAULT_DIRECTIVES
    prompt = ("=== PRIME DIRECTIVES (your immutable core laws — obey above all else) ===\n"
              f"{directives}\n=== END PRIME DIRECTIVES ===\n\n" + PERSONA)
    owner_q = {"user_id": user_id, "$or": [{"speaker": {"$in": [None, ""]}}, {"speaker": {"$exists": False}}]}
    owner_facts = await db.memories.find(owner_q, {"_id": 0}).to_list(400)
    if owner_facts:
        prompt += "\n\nThings you remember about your owner:\n" + "\n".join(f"- {f['content']}" for f in owner_facts)
    if speaker:
        gfacts = await db.memories.find({"user_id": user_id, "speaker": speaker}, {"_id": 0}).to_list(400)
        prompt += f"\n\nYou are currently speaking with {speaker}, recognized by their voice. Address them naturally."
        if gfacts:
            prompt += f"\nWhat you remember about {speaker}:\n" + "\n".join(f"- {f['content']}" for f in gfacts)
    return prompt


async def extract_and_store_memory(user_id: str, user_msg: str, ai_reply: str, speaker: Optional[str] = None):
    """Auto long-term memory: extract durable facts and ongoing work context."""
    try:
        scope_q = {"user_id": user_id, "speaker": speaker} if speaker else \
            {"user_id": user_id, "$or": [{"speaker": {"$in": [None, ""]}}, {"speaker": {"$exists": False}}]}
        existing = await db.memories.find(scope_q, {"_id": 0, "content": 1}).to_list(400)
        if len(existing) > 400:
            return
        existing_text = [e["content"].lower() for e in existing]

        subject = f"the person named {speaker}" if speaker else "the USER (the owner)"
        sys_p = (
            f"Extract durable facts about {subject} worth remembering long-term. "
            "Include: identity, preferences, goals, relationships, AND important ongoing projects or active work. "
            "Ignore trivia and one-off requests. "
            "Return ONLY a JSON array of short fact strings. "
            "If there is nothing worth remembering, return []."
        )
        prompt = f"They said: {user_msg}\nAssistant replied: {ai_reply}\n\nReturn a JSON array of NEW durable facts about {subject}."
        out = await run_llm("openai", "gpt-4o-mini", sys_p, [{"role": "user", "content": prompt}])
        match = re.search(r"\[.*\]", out or "", re.S)
        facts = json.loads(match.group(0)) if match else []

        for f in facts:
            if not isinstance(f, str):
                continue
            fl = f.strip().lower()
            if fl and fl not in existing_text and not any(fl in e or e in fl for e in existing_text):
                await db.memories.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "speaker": speaker,
                    "content": f.strip()[:300],
                    "auto": True,
                    "created_at": now_iso()
                })
                existing_text.append(fl)
    except Exception as e:
        logger.error(f"auto-memory error: {e}")


def tavily_search(query: str):
    if not TAVILY_API_KEY:
        return None
    try:
        r = requests.post("https://api.tavily.com/search", json={
            "api_key": TAVILY_API_KEY, "query": query, "max_results": 5, "include_answer": True,
        }, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.error(f"tavily error {e}")
        return None


# Trivial/social messages that never need a web lookup.
_NO_RESEARCH = ("hello", "hi", "hey", "thanks", "thank you", "ok", "okay", "yes", "no",
                "standby", "stop", "goodbye", "bye", "good morning", "good night")


def should_auto_research(message: str) -> bool:
    """Heuristic: research the web for factual/unknown/current questions, skip small talk."""
    m = (message or "").strip().lower()
    if len(m) < 8:
        return False
    if m in _NO_RESEARCH or any(m == g or m.startswith(g + " ") and len(m) < 14 for g in _NO_RESEARCH):
        return False
    triggers = ("who", "what", "when", "where", "why", "how", "which", "is ", "are ", "was ",
                "were ", "does", "do ", "can ", "latest", "current", "news", "today", "recent",
                "price", "weather", "define", "explain", "look up", "search", "find out",
                "true", "fact", "verify", "happened", "in 2024", "in 2025", "in 2026")
    return "?" in m or any(t in m for t in triggers)


# Text caps for attached documents injected into LLM context
DOC_TEXT_CAP_DEFAULT = 8000
DOC_TEXT_CAP_PDF = 40000  # PDFs are legitimately longer than random pastes


async def load_attachments(attachment_ids: List[str]):
    images, docs = [], []
    for fid in attachment_ids:
        rec = await db.files.find_one({"id": fid, "is_deleted": False}, {"_id": 0})
        if not rec:
            continue
        if (rec.get("content_type") or "").startswith("image/"):
            try:
                data, ct = get_object(rec["storage_path"])
                b64 = base64.b64encode(data).decode()
                images.append(f"data:{ct};base64,{b64}")
            except Exception as e:
                logger.error(f"img attach err {e}")
        elif rec.get("extracted_text"):
            fname = rec.get("original_filename", "unnamed")
            text = rec["extracted_text"]
            pdf_meta = rec.get("pdf_meta")
            if pdf_meta:
                # Rich header for PDFs — page count, form fields, title if present
                bits = [f"{pdf_meta.get('pages', '?')} pages"]
                if pdf_meta.get("title"):
                    bits.append(f"title={pdf_meta['title'][:80]!r}")
                if pdf_meta.get("has_forms"):
                    bits.append("has_forms=true")
                if not pdf_meta.get("ocr_available", True):
                    bits.append("ocr=unavailable")
                header = f"[PDF: {fname}, {', '.join(bits)}]"
                cap = DOC_TEXT_CAP_PDF
            else:
                header = f"[File: {fname}]"
                cap = DOC_TEXT_CAP_DEFAULT

            if len(text) > cap:
                text = text[:cap] + f"\n\n[…truncated at {cap} chars of {len(rec['extracted_text'])} total…]"
            docs.append(f"{header}\n{text}")
    return images, "\n\n".join(docs)


async def run_llm(provider: str, model: str, system_prompt: str, history: list, images=None, doc_text=""):
    user_text = history[-1]["content"]
    if doc_text:
        user_text = f"{user_text}\n\nAttached documents:\n{doc_text}"

    if provider == "anthropic" and ANTHROPIC_API_KEY:
        clt = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        msgs = [{"role": m["role"], "content": m["content"]} for m in history[:-1]]

        # Build user content — text + images if present
        if images:
            user_content = []
            for img_url in images:
                # img_url is "data:<mime>;base64,<data>"
                try:
                    header, b64data = img_url.split(",", 1)
                    media_type = header.split(":")[1].split(";")[0]  # e.g. "image/png"
                    user_content.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64data,
                        },
                    })
                except Exception as e:
                    logger.error(f"[LOUD] Anthropic image attach parse failed for url prefix "
                                 f"'{img_url[:40]}': {e}")
                    raise HTTPException(
                        status_code=400,
                        detail=f"Image attachment failed to parse: {e}"
                    )
            user_content.append({"type": "text", "text": user_text})
        else:
            user_content = user_text

        msgs.append({"role": "user", "content": user_content})

        logger.info(f"Anthropic request: model={model}, messages={len(msgs)}, "
                    f"images={len(images) if images else 0}, has_docs={bool(doc_text)}")

        try:
            resp = await clt.messages.create(
                model=model,
                max_tokens=8192,
                system=system_prompt,
                messages=msgs
            )
        except Exception as e:
            logger.error(f"[LOUD] Anthropic API call failed: {e}")
            raise

        return "".join(getattr(b, "text", "") for b in resp.content)

    clt = openai_client(provider)
    msgs = [{"role": "system", "content": system_prompt}]
    for m in history[:-1]:
        msgs.append({"role": m["role"], "content": m["content"]})
    if images:
        content = [{"type": "text", "text": user_text}]
        for url in images:
            content.append({"type": "image_url", "image_url": {"url": url}})
        msgs.append({"role": "user", "content": content})
    else:
        msgs.append({"role": "user", "content": user_text})
    resp = await clt.chat.completions.create(model=model, messages=msgs, max_tokens=8192)
    return resp.choices[0].message.content


# ---------------------------------------------------------------------------
# GitHub tools for the chat model (read any repo; propose pushes for approval)
# ---------------------------------------------------------------------------
def _parse_repo_url(url: str):
    m = re.search(r"github\.com[:/]+([^/\s]+)/([^/\s#?]+)", url or "")
    if not m:
        # allow bare "owner/repo"
        m2 = re.match(r"^\s*([\w.-]+)/([\w.-]+)\s*$", url or "")
        if not m2:
            raise HTTPException(status_code=400, detail="Could not read a GitHub repo from that URL")
        owner, repo = m2.group(1), m2.group(2)
    else:
        owner, repo = m.group(1), m.group(2)
    if repo.endswith(".git"):
        repo = repo[:-4]
    return owner, repo


async def _repo_default_branch(token, owner, repo):
    info = await _gh(token, "GET", f"/repos/{owner}/{repo}")
    return info.json().get("default_branch", "main")


async def _remember_repo(user_id, owner, repo):
    try:
        await db.github_config.update_one({"user_id": user_id}, {"$set": {"last_repo": f"{owner}/{repo}"}})
    except Exception:
        pass


async def _tool_list_files(user_id, repo_url, branch=None):
    token = await _gh_token(user_id)
    owner, repo = _parse_repo_url(repo_url)
    branch = branch or await _repo_default_branch(token, owner, repo)
    tree = await _gh(token, "GET", f"/repos/{owner}/{repo}/git/trees/{branch}", params={"recursive": "1"})
    paths = [t["path"] for t in tree.json().get("tree", []) if t.get("type") == "blob"]
    await _remember_repo(user_id, owner, repo)
    return {"repo": f"{owner}/{repo}", "branch": branch, "file_count": len(paths), "files": paths[:400]}


async def _tool_read_file(user_id, repo_url, path, branch=None):
    token = await _gh_token(user_id)
    owner, repo = _parse_repo_url(repo_url)
    branch = branch or await _repo_default_branch(token, owner, repo)
    r = await _gh(token, "GET", f"/repos/{owner}/{repo}/contents/{path}", params={"ref": branch})
    data = r.json()
    if isinstance(data, list) or data.get("type") != "file":
        return {"error": "That path is a directory, not a file."}
    raw = base64.b64decode(data["content"].replace("\n", ""))
    try:
        text = raw.decode("utf-8")
    except Exception:
        return {"error": "Binary file — cannot read as text."}
    await _remember_repo(user_id, owner, repo)
    return {"repo": f"{owner}/{repo}", "branch": branch, "path": path, "content": text[:14000]}


def _make_push_proposal(repo_url, branch, message, files, create_branch, open_pr):
    owner, repo = _parse_repo_url(repo_url)
    clean = [{"path": (f.get("path") or "").lstrip("/"), "content": f.get("content", "")}
             for f in (files or []) if f.get("path")]
    return {"repo_url": repo_url, "owner": owner, "repo": repo, "full_name": f"{owner}/{repo}",
            "branch": branch or "main", "message": message or "Update from Promethius",
            "files": clean, "create_branch": bool(create_branch), "open_pr": bool(open_pr)}


async def _exec_gh_tool(name, args, user_id):
    try:
        if name == "list_github_files":
            return await _tool_list_files(user_id, args.get("repo_url"), args.get("branch"))
        if name == "read_github_file":
            return await _tool_read_file(user_id, args.get("repo_url"), args.get("path"), args.get("branch"))
        if name == "propose_github_push":
            prop = _make_push_proposal(args.get("repo_url"), args.get("branch"), args.get("message"),
                                       args.get("files"), args.get("create_branch"), args.get("open_pr"))
            if not prop["files"]:
                return {"error": "No files provided to push."}
            token = await _gh_token(user_id)
            prop["default_branch"] = await _repo_default_branch(token, prop["owner"], prop["repo"])
            await _remember_repo(user_id, prop["owner"], prop["repo"])
            return {"status": "proposal_ready",
                    "note": "A review dialog will open for the user to approve. Do NOT claim it is pushed yet.",
                    "proposal": prop}
        if name == "set_self_repo":
            owner, repo = _parse_repo_url(args.get("repo_url"))
            await db.github_config.update_one({"user_id": user_id},
                                              {"$set": {"self_repo": f"{owner}/{repo}"}})
            return {"status": "ok", "self_repo": f"{owner}/{repo}",
                    "note": "Saved. From now on 'your own code'/'update yourself' refers to this repo."}
    except HTTPException as e:
        return {"error": str(e.detail)}
    except Exception as e:
        return {"error": str(e)[:200]}
    return {"error": "unknown tool"}


async def _exec_pdf_tool(name, args, user_id):
    """Execute PDF generation tools. Returns {file_id, url, ...} on success,
    {error: reason} on failure. Loud on all failures, never silent."""
    try:
        if name == "generate_pdf":
            from tools.pdf import generate_pdf_from_markdown, PdfToolError
            content = args.get("content") or ""
            title = args.get("title") or None
            filename = args.get("filename") or "document.pdf"
            if not filename.lower().endswith(".pdf"):
                filename += ".pdf"
            if not content.strip():
                return {"error": "No content provided to generate PDF."}
            try:
                pdf_bytes = generate_pdf_from_markdown(content, title=title)
            except PdfToolError as e:
                logger.error(f"[pdf tool] generate_pdf failed: {e.reason}")
                return {"error": e.reason}

            # Store the generated PDF in the user's files (same pattern as image gen)
            path = f"{APP_NAME}/generated/{user_id}/{uuid.uuid4()}.pdf"
            put_object(path, pdf_bytes, "application/pdf")

            # Get metadata for the file record
            from tools.pdf import pdf_metadata
            try:
                pdf_meta = pdf_metadata(pdf_bytes)
            except Exception:
                pdf_meta = None

            rec = {
                "id": str(uuid.uuid4()), "user_id": user_id, "storage_path": path,
                "original_filename": filename, "content_type": "application/pdf",
                "size": len(pdf_bytes), "kind": "generated_pdf",
                "extracted_text": content[:20000],
                "pdf_meta": pdf_meta,
                "is_deleted": False, "created_at": now_iso()
            }
            await db.files.insert_one(dict(rec))
            return {
                "status": "ok",
                "file_id": rec["id"],
                "url": f"/api/files/{path}",
                "filename": filename,
                "size_bytes": len(pdf_bytes),
                "pages": (pdf_meta or {}).get("pages", "?"),
                "note": "PDF generated and saved to the user's files. Give them the download link."
            }
    except Exception as e:
        logger.error(f"[pdf tool] {name} exception: {e}")
        return {"error": str(e)[:200]}
    return {"error": "unknown pdf tool"}


_GH_TOOLS_OPENAI = [
    {"type": "function", "function": {
        "name": "list_github_files", "description": "List all files in a GitHub repository. Call this first when the user asks you to look at / pull / review a repo.",
        "parameters": {"type": "object", "properties": {
            "repo_url": {"type": "string", "description": "GitHub repo URL or owner/repo"},
            "branch": {"type": "string", "description": "Optional branch; defaults to the repo default branch"}},
            "required": ["repo_url"]}}},
    {"type": "function", "function": {
        "name": "read_github_file", "description": "Read the text content of one file in a GitHub repository.",
        "parameters": {"type": "object", "properties": {
            "repo_url": {"type": "string"}, "path": {"type": "string", "description": "File path within the repo"},
            "branch": {"type": "string"}}, "required": ["repo_url", "path"]}}},
    {"type": "function", "function": {
        "name": "propose_github_push", "description": "Propose committing/pushing file changes. This does NOT push directly — it opens a review dialog for the user to approve first. Use for any write/commit request.",
        "parameters": {"type": "object", "properties": {
            "repo_url": {"type": "string"}, "branch": {"type": "string"}, "message": {"type": "string", "description": "Commit message"},
            "files": {"type": "array", "items": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}},
            "create_branch": {"type": "boolean"}, "open_pr": {"type": "boolean"}},
            "required": ["repo_url", "message", "files"]}}},
    {"type": "function", "function": {
        "name": "set_self_repo", "description": "Record which GitHub repo IS Promethius's own source code. Call this when the user tells you your repo, so later 'update yourself'/'your own code' works without a URL.",
        "parameters": {"type": "object", "properties": {"repo_url": {"type": "string"}}, "required": ["repo_url"]}}},
]

_GH_TOOLS_ANTHROPIC = [
    {"name": t["function"]["name"], "description": t["function"]["description"], "input_schema": t["function"]["parameters"]}
    for t in _GH_TOOLS_OPENAI
]

_PDF_TOOLS_OPENAI = [
    {"type": "function", "function": {
        "name": "generate_pdf",
        "description": "Generate a PDF document from markdown-formatted content. Use when the user asks you to create, make, generate, or produce a PDF (report, document, summary, letter, etc.). Returns a file_id and download URL. Do NOT claim the PDF exists until this tool succeeds.",
        "parameters": {"type": "object", "properties": {
            "content": {"type": "string", "description": "The full markdown content of the document. Use # for headings, - for bullets."},
            "title": {"type": "string", "description": "Optional document title, shown at the top."},
            "filename": {"type": "string", "description": "Filename for the PDF, e.g. 'quarterly-report.pdf'. Defaults to 'document.pdf'."}
        }, "required": ["content"]}}},
]

_PDF_TOOLS_ANTHROPIC = [
    {"name": t["function"]["name"], "description": t["function"]["description"], "input_schema": t["function"]["parameters"]}
    for t in _PDF_TOOLS_OPENAI
]

PDF_TOOL_GUIDANCE = (
    "\n\n=== PDF ABILITIES ===\n"
    "You can generate PDF documents on demand using the generate_pdf tool. When the user asks you to create/make/produce a PDF "
    "(report, letter, summary, document, invoice, etc.), CALL generate_pdf with markdown content — do not just return raw text. "
    "Use markdown formatting: # Heading, ## Subheading, - bullet, plain paragraphs. Give it a meaningful filename. "
    "After the tool returns, tell the user the PDF was generated and give them the download URL. "
    "Do NOT claim a PDF was created until generate_pdf returns status=ok.\n"
    "=== END PDF ABILITIES ===\n"
)

GH_TOOL_GUIDANCE = (
    "\n\n=== GITHUB ABILITIES ===\n"
    "You can act on GitHub using these tools: list_github_files, read_github_file, "
    "propose_github_push, and set_self_repo. When the user asks you to pull, open, read, review, analyze, "
    "or change a GitHub repo, CALL these tools with the repo URL — do not say you lack access or ask them "
    "to paste code.\n"
    "IMPORTANT: Only call propose_github_push when the user's CURRENT message explicitly asks you to commit, "
    "push, save, apply, or write changes to a repo. For questions, reads, reviews, greetings, casual chat, or "
    "any message that does not clearly request a write, DO NOT call propose_github_push. Never re-propose a "
    "push on a follow-up message unless the user asks again. propose_github_push opens a review dialog for the "
    "user to approve, so never claim something was pushed until they approve. When a push opens a pull request, "
    "a clear PR summary is generated automatically. If the user tells you which repo is YOUR OWN code, call "
    "set_self_repo. If a tool says GitHub is not connected, tell the user to connect their token via the GitHub "
    "button in the chat toolbar.\n"
    "=== END GITHUB ABILITIES ===\n"
)


async def run_chat_openai_tools(provider, model, system_prompt, history, user_id):
    clt = openai_client(provider)
    msgs = [{"role": "system", "content": system_prompt}]
    msgs += [{"role": m["role"], "content": m["content"]} for m in history]
    proposal = None
    all_tools = _GH_TOOLS_OPENAI + _PDF_TOOLS_OPENAI
    pdf_tool_names = {t["function"]["name"] for t in _PDF_TOOLS_OPENAI}
    for _ in range(6):
        resp = await clt.chat.completions.create(model=model, messages=msgs, tools=all_tools, max_tokens=8192)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return (msg.content or ""), proposal
        msgs.append({"role": "assistant", "content": msg.content or "",
                     "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            if tc.function.name in pdf_tool_names:
                result = await _exec_pdf_tool(tc.function.name, args, user_id)
            else:
                result = await _exec_gh_tool(tc.function.name, args, user_id)
            if tc.function.name == "propose_github_push" and result.get("proposal"):
                proposal = result["proposal"]
            tool_content = json.dumps(result)
            if len(tool_content) > 40000 and "proposal" in result:
                # Keep the full proposal, drop only the long note if needed
                slim = {k: v for k, v in result.items() if k != "note"}
                tool_content = json.dumps(slim)
            msgs.append({"role": "tool", "tool_call_id": tc.id, "content": tool_content})
    resp = await clt.chat.completions.create(model=model, messages=msgs, max_tokens=8192)
    return (resp.choices[0].message.content or ""), proposal

async def run_chat_anthropic_tools(model, system_prompt, history, user_id):
    clt = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    msgs = [{"role": m["role"], "content": m["content"]} for m in history]
    proposal = None
    all_tools = _GH_TOOLS_ANTHROPIC + _PDF_TOOLS_ANTHROPIC
    pdf_tool_names = {t["name"] for t in _PDF_TOOLS_ANTHROPIC}
    for _ in range(6):
        resp = await clt.messages.create(model=model, max_tokens=8192, system=system_prompt,
                                         messages=msgs, tools=all_tools)
        tool_uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
        if not tool_uses:
            return "".join(getattr(b, "text", "") for b in resp.content), proposal
        msgs.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        results = []
        for tu in tool_uses:
            if tu.name in pdf_tool_names:
                result = await _exec_pdf_tool(tu.name, tu.input or {}, user_id)
            else:
                result = await _exec_gh_tool(tu.name, tu.input or {}, user_id)
            if tu.name == "propose_github_push" and result.get("proposal"):
                proposal = result["proposal"]
            tool_content = json.dumps(result)
            if len(tool_content) > 40000 and "proposal" in result:
                # Keep the full proposal, drop only the long note if needed
                slim = {k: v for k, v in result.items() if k != "note"}
                tool_content = json.dumps(slim)
            results.append({"type": "tool_result", "tool_use_id": tu.id, "content": tool_content})
        msgs.append({"role": "user", "content": results})
    resp = await clt.messages.create(model=model, max_tokens=8192, system=system_prompt, messages=msgs)
    return "".join(getattr(b, "text", "") for b in resp.content), proposal


@api_router.get("/models")
async def models(user=Depends(get_current_user)):
    """Return providers/models. The Ollama list is merged with whatever is actually
    installed locally (so custom / LoRA-merged models show up automatically)."""
    result = {k: list(v) for k, v in PROVIDERS.items()}
    try:
        tags_url = OLLAMA_BASE_URL.rstrip("/")
        if tags_url.endswith("/v1"):
            tags_url = tags_url[:-3]
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(tags_url.rstrip("/") + "/api/tags")
        if r.status_code == 200:
            installed = [m["name"] for m in r.json().get("models", []) if m.get("name")]
            # keep curated defaults first, then any extra installed models (incl. :latest cleaned)
            seen = set(result["ollama"])
            for name in installed:
                short = name[:-7] if name.endswith(":latest") else name
                if short not in seen:
                    result["ollama"].append(short)
                    seen.add(short)
    except Exception as e:
        logger.info(f"ollama tags unavailable: {e}")
    return result


@api_router.post("/chat")
async def chat(req: ChatReq, user=Depends(get_current_user)):
    uid = user["id"]
    if req.conversation_id:
        conv = await db.conversations.find_one({"id": req.conversation_id, "user_id": uid}, {"_id": 0})
        if not conv:
            raise HTTPException(404, "Conversation not found")
    else:
        conv = {
            "id": str(uuid.uuid4()), "user_id": uid,
            "title": req.message[:48] or "New chat",
            "provider": req.provider, "model": req.model,
            "created_at": now_iso(), "updated_at": now_iso(),
        }
        await db.conversations.insert_one(dict(conv))

    history_docs = await db.messages.find({"conversation_id": conv["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    history = [{"role": m["role"], "content": m["content"]} for m in history_docs]
    history.append({"role": "user", "content": req.message})

    summary = await get_or_create_conversation_summary(conv["id"], history)
    system_prompt = await build_system_prompt(uid, req.speaker)
    if summary:
        system_prompt += f"\n\n=== CURRENT CONVERSATION SUMMARY ===\n{summary}\n=== END SUMMARY ===\n"

    # Inject current session goal
    conv_doc = await db.conversations.find_one({"id": conv["id"]}, {"_id": 0, "current_goal": 1})
    current_goal = (conv_doc or {}).get("current_goal")
    if current_goal:
        system_prompt += f"\n\n=== CURRENT SESSION GOAL ===\n{current_goal}\n=== END GOAL ===\n"

    do_research = req.use_web_search or (bool(TAVILY_API_KEY) and should_auto_research(req.message))
    if do_research:
        res = tavily_search(req.message)
        if res:
            ctx = res.get("answer", "")
            for r in res.get("results", [])[:5]:
                ctx += f"\n- {r.get('title')}: {r.get('content', '')[:300]} ({r.get('url')})"
            system_prompt += (
                "\n\n--- LIVE WEB RESEARCH (retrieved just now for this question) ---\n" + ctx +
                "\n--- END RESEARCH ---\n"
                "Use these live results as your primary source of truth. Cross-check the claims against "
                "each other, prefer facts corroborated by multiple sources, and discard likely fallacies "
                "or single-source claims that conflict with the rest. If the results are insufficient or "
                "contradictory, say so and give your best-supported answer with a brief note on your "
                "confidence. Do not present unverified guesses as established fact."
            )
    elif not TAVILY_API_KEY:
        system_prompt += "\n\n(Note: web search is not yet configured by the admin.)"

    images, doc_text = await load_attachments(req.attachment_ids)
    push_proposal = None
    try:
        if req.provider in ("openai", "anthropic") and not images:
            cfg = await db.github_config.find_one({"user_id": uid}) or {}
            mem = ""
            self_repo = cfg.get("self_repo") or DEFAULT_SELF_REPO
            mem += f"\nYOUR OWN REPO (use when the user says 'your code'/'yourself'/'update yourself'): {self_repo}"
            if cfg.get("last_repo"):
                mem += f"\nLAST REPO the user worked on (use when they say 'the repo'/'that repo' without a URL): {cfg['last_repo']}"
            tool_system = system_prompt + GH_TOOL_GUIDANCE + PDF_TOOL_GUIDANCE + mem
            hist = history
            if doc_text:
                hist = history[:-1] + [{"role": "user", "content": history[-1]["content"] + f"\n\nAttached documents:\n{doc_text}"}]
            if req.provider == "anthropic" and ANTHROPIC_API_KEY:
                reply, push_proposal = await run_chat_anthropic_tools(req.model, tool_system, hist, uid)
            else:
                reply, push_proposal = await run_chat_openai_tools(req.provider, req.model, tool_system, hist, uid)
        else:
            reply = await run_llm(req.provider, req.model, system_prompt, history, images, doc_text)
    except Exception as e:
        logger.error(f"llm error: {e}")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)[:200]}")

    ts = datetime.now(timezone.utc)
    user_msg = {"id": str(uuid.uuid4()), "conversation_id": conv["id"], "user_id": uid,
                "role": "user", "content": req.message, "type": "text",
                "attachment_ids": req.attachment_ids, "created_at": ts.isoformat()}
    ai_msg = {"id": str(uuid.uuid4()), "conversation_id": conv["id"], "user_id": uid,
              "role": "assistant", "content": reply, "type": "text",
              "push_proposal": push_proposal,
              "created_at": (ts + timedelta(milliseconds=1)).isoformat()}
    await db.messages.insert_many([user_msg, ai_msg])
    await db.conversations.update_one({"id": conv["id"]}, {"$set": {"updated_at": now_iso(), "provider": req.provider, "model": req.model}})
    asyncio.create_task(extract_and_store_memory(uid, req.message, reply, req.speaker))
    asyncio.create_task(update_session_goal(conv["id"], req.message, reply))
    return {"conversation_id": conv["id"], "reply": reply, "push_proposal": push_proposal}



# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------
@api_router.get("/conversations")
async def list_conversations(user=Depends(get_current_user)):
    return await db.conversations.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(500)


@api_router.get("/conversations/{conv_id}/messages")
async def conv_messages(conv_id: str, user=Depends(get_current_user)):
    return await db.messages.find({"conversation_id": conv_id, "user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(1000)


@api_router.delete("/conversations/{conv_id}")
async def del_conversation(conv_id: str, user=Depends(get_current_user)):
    await db.conversations.delete_one({"id": conv_id, "user_id": user["id"]})
    await db.messages.delete_many({"conversation_id": conv_id, "user_id": user["id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------
@api_router.post("/voice/transcribe")
async def transcribe(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if ELEVENLABS_API_KEY:
        try:
            from elevenlabs.client import ElevenLabs
            el = ElevenLabs(api_key=ELEVENLABS_API_KEY)
            r = el.speech_to_text.convert(file=BytesIO(data), model_id="scribe_v1")
            text = r.text if hasattr(r, "text") else str(r)
            return {"text": text}
        except Exception as e:
            logger.error(f"elevenlabs stt error {e}")
    clt = openai_client("openai")
    buf = BytesIO(data)
    buf.name = file.filename or "audio.webm"
    out = await clt.audio.transcriptions.create(model="whisper-1", file=buf)
    return {"text": out.text}


@api_router.post("/voice/tts")
async def tts(req: TTSReq, user=Depends(get_current_user)):
    text = req.text[:5000]
    voice_id = req.voice if (req.voice and len(req.voice) > 6) else (user.get("voice_id") or "21m00Tcm4Tlm")
    if ELEVENLABS_API_KEY:
        try:
            from elevenlabs.client import ElevenLabs
            el = ElevenLabs(api_key=ELEVENLABS_API_KEY)
            audio_iter = el.text_to_speech.convert(
                text=text, voice_id=voice_id, model_id="eleven_multilingual_v2", output_format="mp3_44100_128",
            )
            audio = b"".join(audio_iter)
            return Response(content=audio, media_type="audio/mpeg")
        except Exception as e:
            logger.error(f"elevenlabs error {e}")
    clt = openai_client("openai")
    resp = await clt.audio.speech.create(model="tts-1", voice="alloy", input=text[:4000])
    audio = resp.read() if hasattr(resp, "read") else resp.content
    return Response(content=audio, media_type="audio/mpeg")


class SettingsReq(BaseModel):
    voice_id: Optional[str] = None
    orb: Optional[dict] = None
    provider: Optional[str] = None
    model: Optional[str] = None


class DirectivesReq(BaseModel):
    content: str


@api_router.put("/settings")
async def update_settings(req: SettingsReq, user=Depends(get_current_user)):
    upd = {}
    if req.voice_id:
        upd["voice_id"] = req.voice_id
    if req.orb is not None:
        upd["orb"] = req.orb
    if req.provider:
        upd["provider"] = req.provider
    if req.model:
        upd["model"] = req.model
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True, **upd}


@api_router.get("/directives")
async def get_directives(user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "directives": 1})
    saved = (u or {}).get("directives")
    return {"content": saved or DEFAULT_DIRECTIVES, "is_default": not saved}


@api_router.put("/directives")
async def set_directives(req: DirectivesReq, user=Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"directives": req.content}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# API key management (paste your own keys in-app; stored encrypted at rest)
# ---------------------------------------------------------------------------
class KeysReq(BaseModel):
    openai: Optional[str] = None
    anthropic: Optional[str] = None
    elevenlabs: Optional[str] = None
    fal: Optional[str] = None
    tavily: Optional[str] = None
    resend: Optional[str] = None


def _mask_key(v) -> str:
    v = str(v or "")
    if not v:
        return ""
    return (v[:3] + "…" + v[-4:]) if len(v) > 9 else "•••"


def _keys_status() -> dict:
    out = {}
    for f, g in _SECRET_TO_GLOBAL.items():
        val = globals().get(g) or ""
        out[f] = {"set": bool(val), "masked": _mask_key(val)}
    # Chat works out-of-the-box whenever a usable OpenAI key OR the universal key exists.
    out["universal_key"] = {"set": bool(EMERGENT_LLM_KEY)}
    out["chat_ready"] = bool((globals().get("OPENAI_API_KEY") or "") or EMERGENT_LLM_KEY)
    return out


@api_router.get("/settings/keys")
async def get_keys(user=Depends(get_current_user)):
    return _keys_status()


@api_router.put("/settings/keys")
async def set_keys(req: KeysReq, user=Depends(require_admin)):
    doc = await db.app_config.find_one({"id": "secrets"}, {"_id": 0}) or {"id": "secrets"}
    payload = req.model_dump()
    for f in SECRET_FIELDS:
        v = payload.get(f)
        if v is None:
            continue  # field omitted -> leave unchanged
        v = v.strip()
        if v == "":
            # explicit clear -> drop stored value and revert to env default
            doc.pop(f, None)
            _apply_key(f, _ENV_KEY_DEFAULTS.get(f, ""))
        else:
            doc[f] = _gh_fernet.encrypt(v.encode()).decode()
            _apply_key(f, v)
    await db.app_config.update_one({"id": "secrets"}, {"$set": doc}, upsert=True)
    return _keys_status()


# ---------------------------------------------------------------------------
# Speaker recognition (voiceprints) + per-person profiles
# ---------------------------------------------------------------------------
@api_router.get("/speakers")
async def list_speakers(user=Depends(get_current_user)):
    sp = await db.speakers.find({"user_id": user["id"]}, {"_id": 0, "embeddings": 0}).sort("created_at", 1).to_list(200)
    for s in sp:
        s["memory_count"] = await db.memories.count_documents({"user_id": user["id"], "speaker": s["name"]})
    return sp


@api_router.post("/speakers/enroll")
async def enroll_speaker(name: str = Form(...), file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    emb = wav_embedding(data)
    if emb is None:
        raise HTTPException(status_code=400, detail="Could not read voice sample. Record a few seconds of clear speech.")
    name = name.strip()
    existing = await db.speakers.find_one({"user_id": user["id"], "name_lower": name.lower()}, {"_id": 0})
    if existing:
        await db.speakers.update_one({"id": existing["id"]}, {"$push": {"embeddings": emb}})
        return {"id": existing["id"], "name": existing["name"], "updated": True}
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "name": name, "name_lower": name.lower(),
           "embeddings": [emb], "created_at": now_iso()}
    await db.speakers.insert_one(dict(rec))
    return {"id": rec["id"], "name": rec["name"], "updated": False}


@api_router.post("/speakers/identify")
async def identify_speaker(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    emb = wav_embedding(data)
    if emb is None:
        return {"speaker": None, "score": 0}
    profiles = await db.speakers.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    best, best_score = None, 0.0
    for p in profiles:
        for e in p.get("embeddings", []):
            s = cosine_sim(emb, e)
            if s > best_score:
                best_score, best = s, p["name"]
    if best_score >= SPEAKER_THRESHOLD:
        return {"speaker": best, "score": round(best_score, 3)}
    return {"speaker": None, "score": round(best_score, 3)}


@api_router.delete("/speakers/{sid}")
async def delete_speaker(sid: str, user=Depends(get_current_user)):
    sp = await db.speakers.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0})
    if sp:
        await db.memories.delete_many({"user_id": user["id"], "speaker": sp["name"]})
    await db.speakers.delete_one({"id": sid, "user_id": user["id"]})
    return {"ok": True}


@api_router.get("/voice/voices")
async def list_voices(user=Depends(get_current_user)):
    if not ELEVENLABS_API_KEY:
        return {"voices": []}
    try:
        from elevenlabs.client import ElevenLabs
        el = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        res = el.voices.get_all()
        return {"voices": [{"id": v.voice_id, "name": v.name} for v in res.voices][:30]}
    except Exception as e:
        logger.error(f"voices error {e}")
        return {"voices": []}


# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------
@api_router.post("/image/generate")
async def gen_image(req: ImageReq, user=Depends(get_current_user)):
    clt = openai_client("openai")
    try:
        result = await clt.images.generate(model="gpt-image-1", prompt=req.prompt, size="1024x1024")
        b64 = result.data[0].b64_json
        data = base64.b64decode(b64)
    except Exception as e:
        logger.error(f"image error {e}")
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)[:200]}")
    path = f"{APP_NAME}/generated/{user['id']}/{uuid.uuid4()}.png"
    put_object(path, data, "image/png")
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "storage_path": path,
           "original_filename": "generated.png", "content_type": "image/png",
           "kind": "generated_image", "prompt": req.prompt, "is_deleted": False, "created_at": now_iso()}
    await db.files.insert_one(dict(rec))
    return {"id": rec["id"], "url": f"/api/files/{path}"}


@api_router.post("/video/generate")
async def gen_video(req: VideoReq, user=Depends(get_current_user)):
    if not FAL_KEY:
        raise HTTPException(status_code=503, detail="Video generation is not configured yet. Add a fal.ai API key (FAL_KEY) to enable it.")
    try:
        import fal_client
        os.environ["FAL_KEY"] = FAL_KEY
        if req.reference_image_urls:
            model = "fal-ai/ltx-2/image-to-video/fast"
            args = {"prompt": req.prompt, "image_url": req.reference_image_urls[0]}
        else:
            model = "fal-ai/ltx-2/text-to-video/fast"
            args = {"prompt": req.prompt}
        handler = await fal_client.submit_async(model, arguments=args)
        result = await handler.get()
        video = result.get("video") or {}
        url = video.get("url") if isinstance(video, dict) else None
        if not url and isinstance(result.get("videos"), list) and result["videos"]:
            url = result["videos"][0].get("url")
        await db.generated_videos.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "kind": "generated_video",
            "prompt": req.prompt, "video_url": url, "created_at": now_iso()})
        return {"url": url}
    except Exception as e:
        logger.error(f"video error {e}")
        raise HTTPException(status_code=500, detail=f"Video generation failed: {str(e)[:250]}")


@api_router.post("/image/edit")
async def edit_image(file: UploadFile = File(...), prompt: str = Form(...), user=Depends(get_current_user)):
    clt = openai_client("openai")
    data = await file.read()
    buf = BytesIO(data)
    buf.name = file.filename or "image.png"
    try:
        result = await clt.images.edit(model="gpt-image-1", image=buf, prompt=prompt, size="1024x1024")
        out = base64.b64decode(result.data[0].b64_json)
    except Exception as e:
        logger.error(f"image edit error {e}")
        raise HTTPException(status_code=500, detail=f"Image edit failed: {str(e)[:200]}")
    path = f"{APP_NAME}/generated/{user['id']}/{uuid.uuid4()}.png"
    put_object(path, out, "image/png")
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "storage_path": path,
           "original_filename": "edited.png", "content_type": "image/png",
           "kind": "generated_image", "prompt": prompt, "is_deleted": False, "created_at": now_iso()}
    await db.files.insert_one(dict(rec))
    return {"id": rec["id"], "url": f"/api/files/{path}"}


# ---------------------------------------------------------------------------
# Advanced tools: code execution, deep research, data analysis, URL reader
# ---------------------------------------------------------------------------
class CodeReq(BaseModel):
    code: str


class ResearchReq(BaseModel):
    query: str


class UrlReq(BaseModel):
    url: str
    summarize: bool = True


@api_router.post("/tools/run-code")
async def run_code(req: CodeReq, user=Depends(get_current_user)):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(req.code)
        fname = f.name
    try:
        proc = subprocess.run([sys.executable, fname], capture_output=True, text=True, timeout=20)
        out, err = proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        out, err = "", "Execution timed out (20s limit)."
    except Exception as e:
        out, err = "", str(e)
    finally:
        try:
            os.unlink(fname)
        except Exception:
            pass
    return {"stdout": out[-12000:], "stderr": err[-6000:]}


@api_router.post("/tools/research")
async def deep_research(req: ResearchReq, user=Depends(get_current_user)):
    res = tavily_search(req.query)
    if res is None:
        raise HTTPException(status_code=503, detail="Web search is not configured. Add a TAVILY_API_KEY to enable research.")
    sources = res.get("results", [])
    context = res.get("answer", "") + "\n\n" + "\n\n".join(
        f"[{i+1}] {r.get('title')} ({r.get('url')})\n{r.get('content', '')[:1200]}" for i, r in enumerate(sources)
    )
    system = ("You are Promethius performing deep research. Write a thorough, well-structured report "
              "with inline numeric citations like [1], [2] referencing the provided sources. Be comprehensive and accurate.")
    prompt = f"Research question: {req.query}\n\nSources:\n{context}\n\nWrite the full report now."
    report = await run_llm(DEFAULT_PROVIDER, DEFAULT_MODEL, system, [{"role": "user", "content": prompt}])
    return {"report": report, "sources": [{"title": r.get("title"), "url": r.get("url")} for r in sources]}


@api_router.post("/tools/analyze-data")
async def analyze_data(file: UploadFile = File(...), user=Depends(get_current_user)):
    import pandas as pd
    data = await file.read()
    name = (file.filename or "").lower()
    try:
        if name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(BytesIO(data))
        else:
            df = pd.read_csv(BytesIO(data))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {str(e)[:150]}")
    df = df.head(5000)
    columns = [str(c) for c in df.columns]
    preview = df.head(20).fillna("").astype(str).to_dict(orient="records")
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    stats = json.loads(df[numeric_cols].describe().to_json()) if numeric_cols else {}
    chart = None
    if numeric_cols:
        ycol = numeric_cols[0]
        xcol = columns[0]
        sub = df.head(30)
        chart = {"x": xcol, "y": str(ycol), "data": [
            {"name": str(row[xcol]) if xcol in df.columns else str(i),
             "value": float(row[ycol]) if pd.notna(row[ycol]) else 0}
            for i, (_, row) in enumerate(sub.iterrows())
        ]}
    summary = f"Columns: {columns}\nShape: {df.shape}\nNumeric stats: {json.dumps(stats)[:2000]}"
    try:
        insight = await run_llm(DEFAULT_PROVIDER, DEFAULT_MODEL, "You are an expert data analyst. Be concise.",
                                [{"role": "user", "content": f"Give 3-5 key insights from this dataset summary:\n{summary}"}])
    except Exception:
        insight = ""
    return {"columns": columns, "preview": preview, "stats": stats, "chart": chart, "insight": insight, "rows": int(df.shape[0])}


@api_router.post("/tools/read-url")
async def read_url(req: UrlReq, user=Depends(get_current_user)):
    try:
        r = requests.get(req.url, timeout=20, headers={"User-Agent": "Mozilla/5.0 (Promethius)"})
        soup = BeautifulSoup(r.text, "html.parser")
        for t in soup(["script", "style", "nav", "footer", "header"]):
            t.extract()
        text = " ".join(soup.get_text(separator=" ").split())[:14000]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {str(e)[:150]}")
    summary = ""
    if req.summarize and text:
        summary = await run_llm(DEFAULT_PROVIDER, DEFAULT_MODEL, "Summarize the web page clearly with key points and takeaways.",
                                [{"role": "user", "content": f"URL: {req.url}\n\nContent:\n{text}\n\nSummarize."}])
    return {"text": text[:5000], "summary": summary}


# ---------------------------------------------------------------------------
# Scheduled / recurring autonomous tasks
# ---------------------------------------------------------------------------
class ScheduledReq(BaseModel):
    title: str
    prompt: str
    interval_minutes: int = 60


async def _run_scheduled(job_id: str):
    job = await db.scheduled.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return
    system = await build_system_prompt(job["user_id"])
    system += "\n\nYou are running a scheduled autonomous job. Produce the deliverable directly."
    try:
        result = await run_llm(DEFAULT_PROVIDER, DEFAULT_MODEL, system, [{"role": "user", "content": job["prompt"]}])
    except Exception as e:
        result = f"Error: {str(e)[:200]}"
    await db.scheduled_runs.insert_one({
        "id": str(uuid.uuid4()), "job_id": job_id, "user_id": job["user_id"],
        "output": result, "created_at": now_iso(),
    })
    await db.scheduled.update_one({"id": job_id}, {"$set": {"last_run": now_iso()}})


def _add_job(job: dict):
    scheduler.add_job(_run_scheduled, "interval", minutes=max(1, int(job.get("interval_minutes", 60))),
                      args=[job["id"]], id=job["id"], replace_existing=True)


@api_router.get("/scheduled")
async def get_scheduled(user=Depends(get_current_user)):
    jobs = await db.scheduled.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for j in jobs:
        j["runs"] = await db.scheduled_runs.find({"job_id": j["id"]}, {"_id": 0}).sort("created_at", -1).to_list(5)
    return jobs


@api_router.post("/scheduled")
async def create_scheduled(req: ScheduledReq, user=Depends(get_current_user)):
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "title": req.title, "prompt": req.prompt,
           "interval_minutes": req.interval_minutes, "last_run": None, "created_at": now_iso()}
    await db.scheduled.insert_one(dict(rec))
    _add_job(rec)
    rec["runs"] = []
    return rec


@api_router.post("/scheduled/{jid}/run")
async def run_scheduled_now(jid: str, user=Depends(get_current_user)):
    job = await db.scheduled.find_one({"id": jid, "user_id": user["id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    await _run_scheduled(jid)
    runs = await db.scheduled_runs.find({"job_id": jid}, {"_id": 0}).sort("created_at", -1).to_list(5)
    return {"runs": runs}


@api_router.delete("/scheduled/{jid}")
async def del_scheduled(jid: str, user=Depends(get_current_user)):
    await db.scheduled.delete_one({"id": jid, "user_id": user["id"]})
    await db.scheduled_runs.delete_many({"job_id": jid})
    try:
        scheduler.remove_job(jid)
    except Exception:
        pass
    return {"ok": True}


# ---------------------------------------------------------------------------
# Files / uploads
# ---------------------------------------------------------------------------
def extract_text(filename: str, content_type: str, data: bytes) -> str:
    """Extract text from an uploaded file. PDFs route through tools.pdf for
    real extraction (pdfplumber → PyPDF2 → OCR). Other types unchanged.
    Note: Does NOT return PDF metadata — callers that need it (like /upload)
    should call tools.pdf.extract_pdf_text() directly."""
    name = (filename or "").lower()
    try:
        if name.endswith(".pdf") or content_type == "application/pdf":
            from tools.pdf import extract_pdf_text, PdfToolError
            try:
                text, info = extract_pdf_text(data, ocr=True)
                logger.info(f"[pdf] extracted {info['chars_extracted']} chars via {info['method_used']} "
                            f"from {name or 'unnamed.pdf'}")
                return text
            except PdfToolError as e:
                logger.error(f"[pdf] extract failed for {name}: {e.reason}")
                raise  # Let /upload surface the loud error
        if name.endswith(".docx"):
            import docx
            doc = docx.Document(BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs)
        if name.endswith((".txt", ".md", ".csv", ".json", ".py", ".js")) or (content_type or "").startswith("text/"):
            return data.decode("utf-8", errors="ignore")
    except Exception as e:
        logger.error(f"extract error {e}")
    return ""


@api_router.post("/upload")
async def upload(file: UploadFile = File(...), vault: bool = Form(False), user=Depends(get_current_user)):
    data = await file.read()
    ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "bin"
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    ct = file.content_type or "application/octet-stream"

    # PDF pre-flight: loud errors on encrypted / oversized / unreadable before we store anything
    pdf_meta = None
    fname_lower = (file.filename or "").lower()
    is_pdf = fname_lower.endswith(".pdf") or ct == "application/pdf"
    if is_pdf:
        from tools.pdf import pdf_metadata, PdfToolError
        try:
            pdf_meta = pdf_metadata(data)
        except PdfToolError as e:
            logger.error(f"[upload] PDF pre-flight failed for {file.filename}: {e.reason}")
            raise HTTPException(status_code=e.http_status, detail=e.reason)
        if pdf_meta["encrypted"]:
            raise HTTPException(status_code=422,
                                detail="PDF is password-protected. Unlock it first, then re-upload.")

    put_object(path, data, ct)

    # Extract text — for PDFs, tools.pdf handles it; loud raise on PdfToolError
    try:
        extracted = extract_text(file.filename, ct, data)
    except Exception as e:
        # Clean up the just-written object so we don't leak orphaned files
        try:
            from pathlib import Path as _P
            (_P(STORAGE_DIR) / path).unlink(missing_ok=True)
        except Exception:
            pass
        logger.error(f"[upload] text extraction failed for {file.filename}: {e}")
        raise HTTPException(status_code=422,
                            detail=f"Could not extract text from file: {str(e)[:200]}")

    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "storage_path": path,
           "original_filename": file.filename, "content_type": ct, "size": len(data),
           "kind": "vault" if vault else "upload", "extracted_text": extracted,
           "is_deleted": False, "created_at": now_iso()}
    if pdf_meta:
        rec["pdf_meta"] = pdf_meta
    await db.files.insert_one(dict(rec))
    return {"id": rec["id"], "url": f"/api/files/{path}", "original_filename": file.filename,
            "content_type": ct, "has_text": bool(extracted),
            "pdf_meta": pdf_meta}


@api_router.get("/files/{path:path}")
async def download(path: str, user=Depends(get_current_user)):
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    data, ct = get_object(path)
    return Response(content=data, media_type=rec.get("content_type", ct))


# ---------------------------------------------------------------------------
# Personal memory
# ---------------------------------------------------------------------------
@api_router.get("/memory")
async def get_memory(user=Depends(get_current_user)):
    return await db.memories.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/memory")
async def add_memory(req: MemoryReq, user=Depends(get_current_user)):
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "content": req.content, "created_at": now_iso()}
    await db.memories.insert_one(dict(rec))
    return rec


@api_router.delete("/memory/{mid}")
async def del_memory(mid: str, user=Depends(get_current_user)):
    await db.memories.delete_one({"id": mid, "user_id": user["id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Knowledge vault (notes + files)
# ---------------------------------------------------------------------------
@api_router.get("/vault")
async def get_vault(user=Depends(get_current_user)):
    notes = await db.vault_notes.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    files = await db.files.find({"user_id": user["id"], "kind": "vault", "is_deleted": False}, {"_id": 0, "extracted_text": 0}).sort("created_at", -1).to_list(500)
    for f in files:
        f["url"] = f"/api/files/{f['storage_path']}"
    return {"notes": notes, "files": files}


@api_router.post("/vault/note")
async def add_note(req: NoteReq, user=Depends(get_current_user)):
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "title": req.title, "content": req.content, "created_at": now_iso()}
    await db.vault_notes.insert_one(dict(rec))
    return rec


@api_router.delete("/vault/note/{nid}")
async def del_note(nid: str, user=Depends(get_current_user)):
    await db.vault_notes.delete_one({"id": nid, "user_id": user["id"]})
    return {"ok": True}


@api_router.delete("/vault/file/{fid}")
async def del_vault_file(fid: str, user=Depends(get_current_user)):
    await db.files.update_one({"id": fid, "user_id": user["id"]}, {"$set": {"is_deleted": True}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Projects + tasks (with autonomous execution)
# ---------------------------------------------------------------------------
@api_router.get("/projects")
async def get_projects(user=Depends(get_current_user)):
    projects = await db.projects.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for p in projects:
        p["tasks"] = await db.tasks.find({"project_id": p["id"], "user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return projects


@api_router.post("/projects")
async def create_project(req: ProjectReq, user=Depends(get_current_user)):
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "name": req.name,
           "description": req.description, "status": req.status,
           "created_at": now_iso(), "updated_at": now_iso()}
    await db.projects.insert_one(dict(rec))
    rec["tasks"] = []
    return rec


@api_router.delete("/projects/{pid}")
async def del_project(pid: str, user=Depends(get_current_user)):
    await db.projects.delete_one({"id": pid, "user_id": user["id"]})
    await db.tasks.delete_many({"project_id": pid, "user_id": user["id"]})
    return {"ok": True}


@api_router.post("/tasks")
async def create_task(req: TaskReq, user=Depends(get_current_user)):
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "project_id": req.project_id,
           "title": req.title, "description": req.description, "status": "todo",
           "result": "", "created_at": now_iso()}
    await db.tasks.insert_one(dict(rec))
    return rec


@api_router.put("/tasks/{tid}")
async def update_task(tid: str, status: str = Query(...), user=Depends(get_current_user)):
    await db.tasks.update_one({"id": tid, "user_id": user["id"]}, {"$set": {"status": status}})
    return {"ok": True}


@api_router.delete("/tasks/{tid}")
async def del_task(tid: str, user=Depends(get_current_user)):
    await db.tasks.delete_one({"id": tid, "user_id": user["id"]})
    return {"ok": True}


@api_router.post("/tasks/{tid}/execute")
async def execute_task(tid: str, user=Depends(get_current_user)):
    task = await db.tasks.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
    if not task:
        raise HTTPException(404, "Task not found")
    system_prompt = await build_system_prompt(user["id"])
    system_prompt += "\n\nYou are autonomously executing a task. Produce the complete deliverable/result directly."
    prompt = f"Task: {task['title']}\nDetails: {task.get('description','')}\n\nComplete this task now and return the full result."
    try:
        result = await run_llm("openai", "gpt-4o-mini", system_prompt, [{"role": "user", "content": prompt}])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Execution failed: {str(e)[:200]}")
    await db.tasks.update_one({"id": tid, "user_id": user["id"]}, {"$set": {"status": "done", "result": result}})
    return {"result": result}


# ---------------------------------------------------------------------------
# Daily journal
# ---------------------------------------------------------------------------
@api_router.get("/journal")
async def get_journal(user=Depends(get_current_user)):
    return await db.journal.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/journal")
async def add_journal(req: JournalReq, user=Depends(get_current_user)):
    rec = {"id": str(uuid.uuid4()), "user_id": user["id"], "content": req.content,
           "mood": req.mood, "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
           "created_at": now_iso()}
    await db.journal.insert_one(dict(rec))
    return rec


@api_router.delete("/journal/{jid}")
async def del_journal(jid: str, user=Depends(get_current_user)):
    await db.journal.delete_one({"id": jid, "user_id": user["id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Web search (standalone)
# ---------------------------------------------------------------------------
@api_router.post("/search")
async def search(req: SearchReq, user=Depends(get_current_user)):
    res = tavily_search(req.query)
    if res is None:
        raise HTTPException(status_code=503, detail="Web search is not configured. Add a TAVILY_API_KEY to enable it.")
    return res


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
@api_router.get("/admin/stats")
async def admin_stats(user=Depends(require_admin)):
    return {
        "users": await db.users.count_documents({}),
        "conversations": await db.conversations.count_documents({}),
        "messages": await db.messages.count_documents({}),
        "generated_images": await db.files.count_documents({"kind": "generated_image"}),
        "projects": await db.projects.count_documents({}),
    }


@api_router.get("/admin/users")
async def admin_users(user=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(1000)
    for u in users:
        u["conversation_count"] = await db.conversations.count_documents({"user_id": u["id"]})
        u["message_count"] = await db.messages.count_documents({"user_id": u["id"]})
    return users


@api_router.get("/")
async def root():
    return {"message": "Promethius API online"}


# ---------------------------------------------------------------------------
# GitHub integration — Promethius can commit & push to a repo (user-approved)
# ---------------------------------------------------------------------------
APP_ROOT = ROOT_DIR.parent  # /app — Promethius's own source tree
GH_API = "https://api.github.com"
GH_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "Promethius"}
_SELF_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".json", ".md", ".html", ".txt"}
# The repo that IS Promethius's own source (overridable via env / set_self_repo tool).
DEFAULT_SELF_REPO = os.environ.get("SELF_REPO", "rocosfsintec-del/Promethius")
_SELF_MAX_FILE_BYTES = 120_000        # skip any single file larger than this
_SELF_BUNDLE_MAX_BYTES = 3_000_000    # total cap for a full-source bundle
_SELF_SKIP_DIRS = {"node_modules", "__pycache__", "build", ".git", "dist", ".next", "coverage",
                   "venv", ".venv", ".pytest_cache", "storage", "test_reports", "memory", ".emergent"}


def _list_self_paths():
    """All of Promethius's own editable source files (relative to /app)."""
    out = []
    for base in ["backend", "frontend/src", "frontend/public"]:
        root = APP_ROOT / base
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or p.suffix not in _SELF_SUFFIXES:
                continue
            if _SELF_SKIP_DIRS & set(p.parts):
                continue
            out.append(str(p.relative_to(APP_ROOT)))
    # A couple of useful root-level files if present.
    for extra in ["backend/requirements.txt", "frontend/package.json", "README.md"]:
        fp = APP_ROOT / extra
        if fp.is_file():
            rp = str(fp.relative_to(APP_ROOT))
            if rp not in out:
                out.append(rp)
    return sorted(set(out))


class GithubTokenReq(BaseModel):
    token: str


class GhFile(BaseModel):
    path: str
    content: str


class GithubCommitReq(BaseModel):
    owner: str
    repo: str
    branch: str
    message: str
    files: List[GhFile]
    base_branch: Optional[str] = None
    create_branch: bool = False
    open_pr: bool = False
    pr_title: Optional[str] = None
    pr_body: Optional[str] = None


async def _gh_token(user_id: str) -> str:
    doc = await db.github_config.find_one({"user_id": user_id})
    if not doc:
        raise HTTPException(status_code=400, detail="GitHub is not connected. Add a personal access token first.")
    return _gh_fernet.decrypt(doc["token_enc"].encode()).decode()


async def _gh(token: str, method: str, path: str, **kwargs):
    async with httpx.AsyncClient(base_url=GH_API, timeout=30) as c:
        r = await c.request(method, path, headers={**GH_HEADERS, "Authorization": f"Bearer {token}"}, **kwargs)
    if r.status_code >= 400:
        try:
            msg = r.json().get("message", r.text)
        except Exception:
            msg = r.text[:200]
        raise HTTPException(status_code=r.status_code, detail=f"GitHub: {msg}")
    return r


@api_router.post("/github/token")
async def gh_set_token(req: GithubTokenReq, user=Depends(get_current_user)):
    token = req.token.strip()
    if len(token) < 20:
        raise HTTPException(status_code=400, detail="That doesn't look like a valid token.")
    r = await _gh(token, "GET", "/user")  # validate before saving
    login = r.json().get("login")
    await db.github_config.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], "token_enc": _gh_fernet.encrypt(token.encode()).decode(),
                  "login": login, "updated_at": now_iso()}},
        upsert=True)
    return {"connected": True, "login": login}


@api_router.get("/github/status")
async def gh_status(user=Depends(get_current_user)):
    doc = await db.github_config.find_one({"user_id": user["id"]}, {"_id": 0, "token_enc": 0})
    if not doc:
        return {"connected": False}
    return {"connected": True, "login": doc.get("login")}


@api_router.delete("/github/token")
async def gh_disconnect(user=Depends(get_current_user)):
    await db.github_config.delete_one({"user_id": user["id"]})
    return {"ok": True}


@api_router.get("/github/repos")
async def gh_repos(user=Depends(get_current_user)):
    token = await _gh_token(user["id"])
    r = await _gh(token, "GET", "/user/repos", params={
        "affiliation": "owner,collaborator,organization_member", "sort": "updated", "per_page": 100})
    return [{"full_name": x["full_name"], "owner": x["owner"]["login"], "name": x["name"],
             "private": x["private"], "default_branch": x["default_branch"]} for x in r.json()]


@api_router.get("/github/file")
async def gh_read_file(owner: str, repo: str, path: str, branch: str, user=Depends(get_current_user)):
    token = await _gh_token(user["id"])
    try:
        r = await _gh(token, "GET", f"/repos/{owner}/{repo}/contents/{path}", params={"ref": branch})
    except HTTPException as e:
        if e.status_code == 404:
            return {"exists": False, "content": ""}
        raise
    data = r.json()
    if isinstance(data, list) or data.get("type") != "file":
        raise HTTPException(status_code=400, detail="That path is a directory, not a file.")
    raw = base64.b64decode(data["content"].replace("\n", ""))
    try:
        text = raw.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Binary files are not supported here.")
    return {"exists": True, "sha": data["sha"], "content": text}


@api_router.get("/github/self-source")
async def gh_self_source(user=Depends(get_current_user)):
    """List Promethius's own editable source files so it can push changes to itself."""
    files = []
    for base in ["backend", "frontend/src"]:
        root = APP_ROOT / base
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or p.suffix not in _SELF_SUFFIXES:
                continue
            parts = set(p.parts)
            if "node_modules" in parts or "__pycache__" in parts or "build" in parts:
                continue
            files.append(str(p.relative_to(APP_ROOT)))
    return {"files": sorted(files)[:800]}


@api_router.get("/github/self-file")
async def gh_self_file(path: str, user=Depends(get_current_user)):
    """Read one of Promethius's own source files (path-traversal guarded)."""
    root = APP_ROOT.resolve()
    target = (APP_ROOT / path).resolve()
    if not str(target).startswith(str(root)) or not target.is_file():
        raise HTTPException(status_code=400, detail="Invalid file path.")
    try:
        content = target.read_text(encoding="utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot read that file as text.")
    return {"path": path, "content": content}


@api_router.get("/github/self-config")
async def gh_self_config(user=Depends(get_current_user)):
    """Which repo is Promethius itself, plus the last repo the user touched."""
    cfg = await db.github_config.find_one({"user_id": user["id"]}) or {}
    return {
        "self_repo": cfg.get("self_repo") or DEFAULT_SELF_REPO,
        "is_default": not cfg.get("self_repo"),
        "default_repo": DEFAULT_SELF_REPO,
        "last_repo": cfg.get("last_repo"),
        "connected": bool(cfg.get("token_enc")),
    }


class SelfRepoReq(BaseModel):
    repo_url: str


@api_router.put("/github/self-config")
async def gh_set_self_config(req: SelfRepoReq, user=Depends(get_current_user)):
    owner, repo = _parse_repo_url(req.repo_url)
    await db.github_config.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], "self_repo": f"{owner}/{repo}"}},
        upsert=True)
    return {"self_repo": f"{owner}/{repo}"}


@api_router.get("/github/self-bundle")
async def gh_self_bundle(user=Depends(get_current_user)):
    """Read Promethius's entire live source in one call, so the UI can stage a
    full-source sync commit. Content is capped to keep the payload sane."""
    root = APP_ROOT.resolve()
    files, skipped, total = [], [], 0
    for rel in _list_self_paths():
        target = (APP_ROOT / rel).resolve()
        if not str(target).startswith(str(root)) or not target.is_file():
            continue
        try:
            size = target.stat().st_size
            if size > _SELF_MAX_FILE_BYTES:
                skipped.append({"path": rel, "reason": f"large ({size} bytes)"})
                continue
            if total + size > _SELF_BUNDLE_MAX_BYTES:
                skipped.append({"path": rel, "reason": "bundle size limit"})
                continue
            content = target.read_text(encoding="utf-8")
        except Exception:
            skipped.append({"path": rel, "reason": "not text"})
            continue
        total += size
        files.append({"path": rel, "content": content})
    cfg = await db.github_config.find_one({"user_id": user["id"]}) or {}
    return {
        "repo": cfg.get("self_repo") or DEFAULT_SELF_REPO,
        "file_count": len(files),
        "total_bytes": total,
        "skipped": skipped,
        "files": files,
    }


@api_router.post("/github/commit")
async def gh_commit(req: GithubCommitReq, user=Depends(get_current_user)):
    if not req.files:
        raise HTTPException(status_code=400, detail="No files to push.")
    for f in req.files:
        clean = f.path.lstrip("/")
        if ".." in clean.split("/"):
            raise HTTPException(status_code=400, detail=f"Invalid path: {f.path}")
    token = await _gh_token(user["id"])
    owner, repo = req.owner, req.repo
    base = req.base_branch or req.branch

    try:
        ref = await _gh(token, "GET", f"/repos/{owner}/{repo}/git/ref/heads/{base}")
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(status_code=400, detail=f"Base branch '{base}' not found in {owner}/{repo}.")
        raise
    base_sha = ref.json()["object"]["sha"]

    if req.create_branch and req.branch != base:
        try:
            await _gh(token, "POST", f"/repos/{owner}/{repo}/git/refs",
                      json={"ref": f"refs/heads/{req.branch}", "sha": base_sha})
        except HTTPException as e:
            if e.status_code != 422:  # 422 = branch already exists
                raise

    commit_obj = await _gh(token, "GET", f"/repos/{owner}/{repo}/git/commits/{base_sha}")
    base_tree = commit_obj.json()["tree"]["sha"]

    tree = []
    for f in req.files:
        blob = await _gh(token, "POST", f"/repos/{owner}/{repo}/git/blobs",
                         json={"content": base64.b64encode(f.content.encode()).decode(), "encoding": "base64"})
        tree.append({"path": f.path.lstrip("/"), "mode": "100644", "type": "blob", "sha": blob.json()["sha"]})

    new_tree = await _gh(token, "POST", f"/repos/{owner}/{repo}/git/trees",
                         json={"base_tree": base_tree, "tree": tree})
    commit = await _gh(token, "POST", f"/repos/{owner}/{repo}/git/commits",
                       json={"message": req.message, "tree": new_tree.json()["sha"], "parents": [base_sha]})
    new_sha = commit.json()["sha"]
    await _gh(token, "PATCH", f"/repos/{owner}/{repo}/git/refs/heads/{req.branch}",
              json={"sha": new_sha, "force": False})

    result = {"commit_sha": new_sha, "branch": req.branch,
              "commit_url": f"https://github.com/{owner}/{repo}/commit/{new_sha}"}
    if req.open_pr and req.branch != base:
        if req.pr_body:
            body = req.pr_body
        else:
            changes = await _collect_changes(token, owner, repo, base, req.files)
            body = await _summarize_changes(req.message, changes)
        body = body.rstrip() + "\n\n---\n_Change summary written by Promethius._"
        pr = await _gh(token, "POST", f"/repos/{owner}/{repo}/pulls",
                       json={"title": req.pr_title or req.message, "body": body,
                             "head": req.branch, "base": base})
        result["pr_url"] = pr.json().get("html_url")
        result["pr_number"] = pr.json().get("number")
    return result


async def _fetch_old_content(token, owner, repo, base_branch, path):
    """Old text of a file on the base branch. ('', 'added') if it doesn't exist."""
    try:
        r = await _gh(token, "GET", f"/repos/{owner}/{repo}/contents/{path}", params={"ref": base_branch})
        data = r.json()
        if isinstance(data, dict) and data.get("type") == "file":
            try:
                return base64.b64decode(data["content"].replace("\n", "")).decode("utf-8"), "modified"
            except Exception:
                return "", "binary"
    except HTTPException as e:
        if e.status_code != 404:
            raise
    return "", "added"


async def _collect_changes(token, owner, repo, base_branch, files):
    """Only the files that actually differ from the base branch."""
    changes = []
    for f in files:
        path = f.path.lstrip("/")
        old, status = await _fetch_old_content(token, owner, repo, base_branch, path)
        if status == "binary" or old == f.content:
            continue
        changes.append({"path": path, "status": status, "old": old, "new": f.content})
    return changes


def _compact_diff(old, new, max_lines=60):
    import difflib
    body = [l for l in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=1)
            if not (l.startswith("---") or l.startswith("+++"))]
    if len(body) > max_lines:
        body = body[:max_lines] + [f"... (+{len(body) - max_lines} more diff lines)"]
    return "\n".join(body)


async def _summarize_changes(message, changes):
    """Plain-English PR description generated from the real diffs."""
    if not changes:
        return f"{message}\n\n_No file changes detected against the base branch._"
    listing = "\n".join(f"- `{c['path']}` ({c['status']})" for c in changes)
    blocks, budget = [], 12000
    for c in changes:
        block = f"### {c['path']} ({c['status']})\n```diff\n{_compact_diff(c['old'], c['new'])}\n```"
        if len(block) > budget:
            blocks.append(f"### {c['path']} ({c['status']}) — diff omitted (length budget)")
            continue
        budget -= len(block)
        blocks.append(block)
    sys_p = ("You are a senior engineer writing a clear, plain-English pull request description for a "
             "non-technical reader. From the intent and the ACTUAL diffs, explain WHAT changed and WHY it "
             "matters. Use markdown: one or two summary sentences, then a short bullet list grouped by area. "
             "Avoid jargon, don't just restate code, keep it to ~12 bullets max.")
    prompt = f"Intent / commit message: {message}\n\nChanged files:\n{listing}\n\nDiffs:\n" + "\n\n".join(blocks)
    try:
        txt = (await run_llm("openai", "gpt-4o-mini", sys_p, [{"role": "user", "content": prompt}]) or "").strip()
    except Exception as e:
        logger.error(f"change summary llm: {e}")
        txt = ""
    return txt or f"{message}\n\n**Changed files:**\n{listing}"


async def _generate_pr_summary(message, files):
    listing = "\n".join(f"- `{f.path}` ({len(f.content.splitlines())} lines)" for f in files)
    try:
        snippets = "\n\n".join(f"### {f.path}\n```\n{f.content[:1500]}\n```" for f in files[:6])
        sys_p = ("You write concise, clear GitHub pull request descriptions in markdown. "
                 "4-8 lines: a one-line summary, then a short bullet list of what changed and why.")
        prompt = f"Commit message: {message}\n\nChanged files:\n{listing}\n\nFile contents:\n{snippets}\n\nWrite the PR description."
        txt = await run_llm("openai", "gpt-4o-mini", sys_p, [{"role": "user", "content": prompt}])
        txt = (txt or "").strip()
        if txt:
            return txt + f"\n\n---\n_Opened by Promethius._"
    except Exception as e:
        logger.error(f"pr summary error: {e}")
    return f"{message}\n\n**Changed files:**\n{listing}\n\n_Opened by Promethius._"


class GhDiffReq(BaseModel):
    owner: str
    repo: str
    base_branch: str
    files: List[GhFile]


@api_router.post("/github/diff")
async def gh_diff(req: GhDiffReq, user=Depends(get_current_user)):
    """Return old vs new content for each file so the UI can show a before/after diff."""
    token = await _gh_token(user["id"])
    out = []
    for f in req.files:
        path = f.path.lstrip("/")
        old, status = "", "added"
        try:
            r = await _gh(token, "GET", f"/repos/{req.owner}/{req.repo}/contents/{path}",
                          params={"ref": req.base_branch})
            data = r.json()
            if isinstance(data, dict) and data.get("type") == "file":
                try:
                    old = base64.b64decode(data["content"].replace("\n", "")).decode("utf-8")
                    status = "modified"
                except Exception:
                    old, status = "", "binary"
        except HTTPException as e:
            if e.status_code != 404:
                raise
        out.append({"path": f.path, "status": status, "old": old, "new": f.content})
    return out


class ChangeSummaryReq(BaseModel):
    owner: str
    repo: str
    base_branch: str
    message: Optional[str] = "Update from Promethius"
    files: List[GhFile]


@api_router.post("/github/change-summary")
async def gh_change_summary(req: ChangeSummaryReq, user=Depends(get_current_user)):
    """Plain-English summary of what changed vs the base branch — for PR preview."""
    token = await _gh_token(user["id"])
    changes = await _collect_changes(token, req.owner, req.repo, req.base_branch, req.files)
    summary = await _summarize_changes(req.message, changes)
    return {
        "summary": summary,
        "changed": [c["path"] for c in changes],
        "changed_count": len(changes),
        "total": len(req.files),
        "unchanged_count": len(req.files) - len(changes),
    }


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Serve the built React app (production / run-on-boot mode).
# Only activates when a frontend build exists — the dev/preview setup (separate
# frontend server) is unaffected.
# ---------------------------------------------------------------------------
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

FRONTEND_BUILD = Path(os.environ.get("FRONTEND_BUILD_DIR", str(Path(__file__).parent.parent / "frontend" / "build")))
if (FRONTEND_BUILD / "index.html").is_file():
    if (FRONTEND_BUILD / "static").is_dir():
        app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD / "static")), name="static")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("api"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = FRONTEND_BUILD / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_BUILD / "index.html"))

    logger.info(f"Serving frontend build from {FRONTEND_BUILD}")


@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logger.info(f"Local storage ready at {STORAGE_DIR}")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    try:
        await load_stored_keys()
        logger.info("API keys loaded from store")
    except Exception as e:
        logger.error(f"Key load failed: {e}")
    try:
        jobs = await db.scheduled.find({}, {"_id": 0}).to_list(500)
        for j in jobs:
            _add_job(j)
        if not scheduler.running:
            scheduler.start()
        logger.info(f"Scheduler started with {len(jobs)} jobs")
    except Exception as e:
        logger.error(f"Scheduler init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    client.close()
