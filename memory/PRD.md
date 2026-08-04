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

## Backlog / next
- P1: Chat requires an LLM key (ANTHROPIC_API_KEY / OPENAI_API_KEY) or local Ollama.
- P1: Push repaired baseline back to existing GitHub repo (no delete needed).
- P2: Review the self-modification/GitHub feature that caused the break to add guardrails.
