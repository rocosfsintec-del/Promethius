# Promethius — Restoration PRD

## Original problem statement
User built "Promethius" (a personal AI) on Emergent, pushed to a private GitHub repo
(rocosfsintec-del/Promethius), ran it locally, and a self-modification feature broke the
local run. Symptom reported: "calling for localhost:3000 but pulling up 8001."
User asked to pull the repo into a fresh workspace and repair it.

## Architecture
- Backend: FastAPI (backend/server.py), MongoDB (motor), APScheduler.
- Frontend: React + CRACO + Tailwind + shadcn/ui. Pages: Orb, Auth (WebAuthn passkey),
  Workspace (chat), Admin, InstallGuide.
- Auth: WebAuthn passkeys (fingerprint/FaceID/device).
- Integrations (optional, key-gated): Anthropic (claude-sonnet-4-6 default), OpenAI
  (chat/image/Whisper), ElevenLabs (TTS/STT), Tavily (search), fal.ai (video),
  Resend (email), Ollama (local offline LLM).

## Work done (2026-08-04)
- Cloned private repo into workspace via GitHub PAT.
- Diagnosed root cause: code is env-driven and correct; frontend/src/lib/api.js uses
  process.env.REACT_APP_BACKEND_URL. The "3000 vs 8001" bug was a local .env
  misconfiguration (not committed to repo), confirmed by user's revert having no effect.
- Set up workspace env: backend/.env (MONGO_URL, DB_NAME, CORS_ORIGINS, JWT_SECRET),
  kept Emergent-managed REACT_APP_BACKEND_URL.
- Installed backend (pip) + frontend (yarn) deps; restarted services.
- Verified: backend health "Promethius API online", frontend login screen renders, no errors.

## Correct local run config (for user's machine)
- frontend/.env: REACT_APP_BACKEND_URL=http://localhost:8001
- Open app at http://localhost:3000 (frontend). Backend runs on 8001.
- backend/.env needs: MONGO_URL, DB_NAME, JWT_SECRET, CORS_ORIGINS, and any LLM keys.

## Work done (2026-06 — pull & repair by E1)
- Repo re-cloned into fresh workspace; boot was crashing on missing `.env` files.
- Recreated backend/.env (MONGO_URL, DB_NAME, JWT_SECRET, CORS, WebAuthn origins) and
  frontend/.env (REACT_APP_BACKEND_URL, WDS_SOCKET_PORT). Backend now boots, passkey login renders.
- **Chat made functional end-to-end WITHOUT requiring user keys**: wired the Emergent
  Universal Key via the OpenAI-compatible proxy (INTEGRATION_PROXY_URL + '/llm').
  `openai_client()` now: Ollama→local; native OpenAI key→direct; otherwise→Universal Key proxy.
  The proxy serves OpenAI *and* Anthropic model names, so `anthropic` provider routes through
  the same OpenAI path (with OpenAI tool schema) when no native Anthropic key is set.
  Verified via API: gpt-4o-mini, claude-sonnet-4-6, and the generate_pdf tool loop all work.
- **In-app API keys panel (BYO keys)**: new `db.app_config` doc "secrets" stores per-service keys
  (openai, anthropic, elevenlabs, fal, tavily, resend) encrypted with Fernet (JWT_SECRET-derived).
  Endpoints: GET /api/settings/keys (masked status + chat_ready), PUT /api/settings/keys (admin only,
  live-updates module globals, revert-to-env on clear). Loaded on startup via load_stored_keys().
  Frontend: Settings → "API" tab (VoiceSettings.jsx ApiKeysTab) to paste/replace/clear keys.
- image/tts/whisper/edit now also honor pasted OpenAI key / Universal Key fallback.

## Backlog / next
- P1: Anthropic-native tool path only used when a real ANTHROPIC_API_KEY is set (else proxy).
- P1: Push repaired baseline back to existing GitHub repo (no delete needed).
- P2: Review the self-modification/GitHub feature that caused the break to add guardrails.

## Feature: GitHub Push from chat (2026-08-04)
- Promethius can now commit & push to any repo the user's PAT can access, from a Push
  button in the chat toolbar (data-testid='github-push-button').
- Backend (server.py): POST /api/github/token (validate+store), GET /api/github/status,
  DELETE /api/github/token, GET /api/github/repos, GET /api/github/file,
  GET /api/github/self-source, GET /api/github/self-file, POST /api/github/commit
  (atomic blobs->tree->commit->ref, optional new branch + PR).
- PAT is encrypted at rest with Fernet (key derived from JWT_SECRET), stored in
  db.github_config per user, never returned to the client.
- Frontend (components/GithubPush.jsx): connect -> compose (repo/branch/message/files)
  -> REVIEW (approval gate; only "Approve & Push" commits) -> done (commit link).
  Files can come from the last chat reply, Promethius's own source, or blank/manual.
- Verified: backend curl (real commit created+deleted) and full UI (testing agent, 6/6).
- Note: uses user-supplied GitHub PAT (repo scope). No new .env var required.
