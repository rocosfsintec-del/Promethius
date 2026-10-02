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

## Self-update repo (2026-06 — E1)
- Goal: let Promethius keep its own GitHub repo in sync ("both": one-click full-source sync + AI-proposed edits).
- Default self-repo = `rocosfsintec-del/Promethius` (env `SELF_REPO` overridable). Chat now always
  knows its own repo (memory injection defaults to it) — verified: asking "your repo" returns it.
- New backend endpoints (backend/server.py):
  - GET  /api/github/self-config  → {self_repo, is_default, default_repo, last_repo, connected}
  - PUT  /api/github/self-config  → set self_repo from a URL/owner-repo
  - GET  /api/github/self-bundle  → entire live source in ONE call (93 files, ~0.5MB),
    excludes node_modules/storage/memory/.env/tests-caches/etc so NO secrets or uploads leak (verified).
- Frontend (GithubPush.jsx): new "Self-update" card in compose step with a `github-sync-source`
  ("Sync all") button → loads the bundle, targets the self-repo, stages a `promethius-sync` branch
  + PR, and jumps straight to the review→approve→push gate. Review auto-diff is skipped when >40
  files (rate-limit safety); file list still shows per-file add counts.
- AI-driven path (b) already worked (list/read/propose_github_push tools + review dialog); now
  seamless because the self-repo no longer needs to be set manually.
- NOT yet tested live: the actual commit/push and the connected-state UI — these require the
  user's GitHub Personal Access Token (repo scope), which the user will paste into the in-app
  GitHub panel later. Backend read endpoints + chat recognition verified via curl.

## Change summary for PRs (2026-06 — E1)
- Every self-update PR now carries a plain-English "what changed" description generated from the
  ACTUAL diff (not just a file list). Unchanged/binary files are skipped.
- Backend (server.py): _fetch_old_content, _collect_changes (diff vs base branch), _compact_diff
  (difflib, capped), _summarize_changes (LLM gpt-4o-mini via Universal Key → markdown summary,
  grouped by area). Used automatically for the PR body in /github/commit when open_pr and no
  pr_body supplied. New preview endpoint POST /api/github/change-summary returns
  {summary, changed[], changed_count, total, unchanged_count}.
- Frontend (GithubPush.jsx): editable "Change summary" panel in the review step (shown when
  open_pr + new branch). Auto-generates on entering review, has a Regenerate button, shows
  "changed/total", and the edited text is sent as the PR body on push.
- Verified: _summarize_changes produces a clear, diff-aware plain-English description via curl/script.
  Live PR body still exercised only once the user connects a GitHub token (change-summary endpoint
  needs it to read old content from GitHub).
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

## Orb replaced with user's LLMOrb (2026-06)
- Ported the user's exact LLMOrb canvas (energy sphere + bright pulsing core + rim + 26 curved flame tongues, hue-based) into pages/Orb.jsx useOrbCanvas.
- Driven by live energy/voice: activity maps to their idle/thinking/speaking params (pulse/swirl/brightness/flicker). Color picker -> hue (hexToHue), size -> radius, density -> flame count, chaos -> flicker, floatSpeed -> bob, lightning -> brightness; standby dims, green flash -> hue 140. tipColor now unused by this orb (kept in settings, harmless).

## LLM key priority inverted + Opus 4.8 (2026-06)
- Per user choice, Emergent Universal Key is now PRIMARY for LLM chat; pasted/env
  BYO OpenAI/Anthropic keys are fallback-only (used only when EMERGENT_LLM_KEY absent).
  Changed openai_client(), run_llm() anthropic branch, and the chat tools dispatch
  (all now gated on `not EMERGENT_LLM_KEY`). Universal proxy routes both OpenAI and
  Anthropic model names via LiteLLM. Verified gpt-4o-mini + claude-sonnet-5 return OK.
- Added `claude-opus-4-8` ("Claude Opus 4.8") to PROVIDERS["anthropic"] and to
  ChatPanel MODEL_LABELS / MODEL_COST (expensive) / MODEL_PRICING ([15,75]).
  Confirmed the model ID resolves through the Universal proxy (claude-opus-4-8, not 4.8).

## Model Picker billing badges (2026-06)
- ChatPanel.jsx now shows a "Universal" / "Your Key" / "Local" / "No key" badge next
  to each model and on the selector trigger, so the user sees which key will be billed.
- Logic (billingOf) mirrors backend priority: ollama->Local; Universal Key set->Universal
  for all cloud models; else BYO openai/anthropic key set->Your Key; else No key.
  Fetches /api/settings/keys on mount (universal_key.set, openai.set, anthropic.set).
- Added a two-chip legend in the dropdown footer. Verified live via passkey UI: all cloud
  models show orange "Universal", Ollama shows green "Local".

## Session Spend Meter (2026-06)
- ChatPanel header now shows a live "Universal Key" spend meter (⚡ icon) that accumulates
  the actual per-reply cost as you chat. Tracks {universal, total, n} in sessionStorage
  (survives conversation switches, resets per browser tab session). Click to reset.
- bumpSpend(provider, model, inText, outText) runs after each reply; adds cost to the
  universal bucket only when billingOf()==="universal", always to total. Tooltip shows
  Universal spend, total (all keys), and message count.
- Replaced the old per-conversation "session-cost" estimate (which recomputed all history
  at the current model rate) with this accurate accumulating meter. testid: session-spend-meter.
- Verified live via passkey UI: sent a message, meter appeared with Universal Key spend.

## Grok (xAI) BYO provider + Auto-Model Router (2026-06)
- Added "auto" router: chat() resolves provider/model=="auto" via auto_select_model(), a
  gpt-4o-mini classifier (Universal Key) that picks the cheapest-capable ONLINE model.
  Auto is the DEFAULT (Workspace + Orb voice default to "auto"/"auto"); manual pick persists.
  Response + stored ai_msg carry provider/model/auto_selected; UI shows "Auto → <model>" tag
  (testid auto-picked-model). Dropdown widened to w-80, no truncation, "Auto (Smart)" pinned top.
- Added xAI Grok as a BYO provider (Universal Key does NOT cover Grok). PROVIDERS["xai"]=
  ["grok-4.6","grok-4"]; XAI_API_KEY global + XAI_BASE_URL (https://api.x.ai/v1); openai_client
  routes provider=="xai" to xAI's OpenAI-compatible endpoint with the user's key (never universal).
  Added xai to SECRET_FIELDS/_SECRET_TO_GLOBAL, KeysReq, _VERIFIABLE_KEYS (GET /v1/models),
  models_status, auto-router candidates + AUTO_MODEL_MENU. Frontend: MODEL_LABELS/COST/PRICING
  (grok-4.6 [2,6], grok-4 [3,15]), billingOf("xai")->"byo", VoiceSettings KEY_FIELDS xai entry.
- Verified live: owner's xAI key saved+verified (valid), Grok 4.6 direct chat returns a real reply,
  xai online=true, dropdown shows Grok 4.6/Grok 4 online with blue "Your Key" badge.

## Grok reasoning effort control (2026-06)
- Per-chat low/medium/high/xhigh reasoning effort for Grok 4.6 (speed vs depth).
  Backend: ChatReq.reasoning_effort; _xai_extra(provider,model,effort) gates it to
  provider=="xai" and model in XAI_EFFORT_MODELS={"grok-4.6"}, passed as reasoning_effort
  kwarg into run_chat_openai_tools (both create calls) and run_llm. Verified xAI accepts
  low & xhigh live.
- Frontend: segmented control in chat header (testid grok-effort-control, buttons
  grok-effort-{low,medium,high,xhigh}), visible ONLY when provider=='xai' && model=='grok-4.6',
  default 'high', persisted in localStorage promethius_grok_effort, sent in /chat payload.
  Verified via UI: hidden by default, appears on selecting Grok 4.6, xhigh highlights.

## App version label (2026-06)
- Added visible version "v27.5.0" (base v27.4.22, bumped for Grok/auto-router/spend-meter/
  scrollable-picker batch). Single source: frontend/src/lib/version.js -> APP_VERSION.
  Shown in Sidebar brand (testid app-version) and Auth screen (testid app-version-auth).
