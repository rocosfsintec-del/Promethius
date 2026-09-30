# Promethius — Changelog

## 2026-06 (fork — chat online, key manager, GitHub self-update, orb = LLMOrb)
- **Chat works with zero setup**: `openai_client()` routes through the Emergent Universal Key (OpenAI-compatible proxy) when no native key is set — serves OpenAI *and* Anthropic model names. Native OpenAI key (pasted/env) preferred; Ollama stays local. Anthropic-native path only when ANTHROPIC_API_KEY present.
- **In-app API key manager** (Settings → API): paste OpenAI/Anthropic/ElevenLabs/fal/Tavily/Resend keys. Stored encrypted (Fernet) in `db.app_config` doc `secrets`, applied to live globals on save + on startup (`load_stored_keys`). GET/PUT `/api/settings/keys`. **Not admin-gated** (personal app) — any signed-in user can manage keys.
- **GitHub token card** in the API tab (`/api/github/token` connect/status/disconnect). `GET /api/github/status` reports connected only when a token is stored (self-repo-only docs → false). Disconnect keeps self_repo. Paste box always visible (paste-to-replace).
- **GitHub self-update**: default self-repo `rocosfsintec-del/Promethius`; `GET /api/github/self-config|self-bundle` (whole live source in one call, excludes storage/memory/.env/caches). GithubPush "Sync all" → stages a `promethius-sync` branch + PR. Chat knows its own repo.
- **Change summary for PRs**: diff-aware plain-English PR body (`_collect_changes`/`_summarize_changes`), preview via `POST /api/github/change-summary`, editable panel in the push review step.
- **Cost-aware model dropdown**: colour tiers (green free / yellow moderate / red premium), estimated $/msg per model, live per-message cost chip.
- **Orb = user's LLMOrb** (`pages/Orb.jsx useOrbCanvas`): energy sphere + pulsing core + rim + curved flame tongues, hue from colour picker; live activity maps to idle/thinking/speaking params; size/density/chaos/floatSpeed/glow honoured; standby dims; green flash.
- **WebAuthn origin** realigned to current preview host `prom-metrics.preview.emergentagent.com`.

### Verified (this fork)
- Chat E2E via Universal Key (gpt-4o-mini, claude-sonnet-4-6, tool loop) — curl + testing agent.
- API keys: non-admin save/persist/clear — curl. GitHub status logic (self-repo-only → not connected) — curl.
- Orb LLMOrb render — visual parity with source.
- Frontend compiles clean (only exhaustive-deps warnings).

## 2026-06-30 (fork 2 — desktop app: PWA install, run-on-boot, fullscreen launcher)
- **Backend serves the built UI** on port 8001 when `frontend/build` exists (guarded; cloud/dev preview unaffected). Single-process production mode.
- **PWA / Install Desktop App**: `manifest.json` (standalone, fullscreen override), `service-worker.js` (network-first, skips /api, offline shell), flame favicon + 192/512 icons, `src/pwa.js` registers SW + captures beforeinstallprompt. **"Install Desktop App" button** in the Settings modal footer (`install-app-button` / `install-app-status`).
- **Windows run-on-boot + desktop icon**: root scripts — `build-promethius.bat`, `run-promethius.bat`, `promethius-hidden.vbs`, `launch-promethius.bat` (Chrome/Edge `--app --start-fullscreen`), `install-promethius.ps1` (logon ScheduledTask + Desktop shortcut with `promethius.ico`), `uninstall-promethius.ps1`.
- Verified iter 9: backend 8/8, PWA assets serve, SW registers, install button renders in settings (headless fallback state).

## Earlier this session
- **Local-disk storage**: replaced Emergent object storage with filesystem (`STORAGE_DIR`, default `backend/storage`). Upload→download verified. Runs fully offline.
- **Voice-amplitude pulse**: wired the orb canvas `voiceRef` so lightning/pulse track ElevenLabs TTS amplitude.
- **instruction.pdf**: detailed local-install guide (Win/macOS/Linux, Ollama + cloud-keys) via reportlab; served at `/instruction.pdf`.
- **Interactive Install Guide** (`/install`, public route): clickable OS tabs, copy code blocks, all `.env` shown, Download-PDF fallback. Linked from Orb + Auth.
- **One-command launcher**: `start.sh` / `start.bat` at project root (boots Mongo + backend + frontend).
- **requirements.txt cleanup (CRITICAL for local install)**: removed `emergentintegrations`, internal-URL `litellm`, and the unused google/grpc/proto cluster (`google-*`, `googleapis-*`, `grpcio*`, `proto-plus`, `protobuf`, `httplib2`, `uritemplate`). These broke `pip install` on a normal machine (internal asset URL + grpcio-status version conflict). None are imported by the app.
- **Orb voice bug fixes** (tested iter 6):
  - `ask()` no longer swallows errors — surfaces a toast with the server detail; falls back to a text toast of the reply if voice fails.
  - `speak()` returns a bool and toasts on TTS failure (shows the reply text + flags bad ElevenLabs key).
  - Wake-word matching broadened from exact `promethius` to regex `/prom[ae]th[a-z]*/` (Chrome hears "prometheus").
- **Orb freeze fix** (tested iter 7): canvas render-loop performance caps — `eff` ≤ 1.2, `arcs` ≤ 30 (chaos clamped to 1.6, multiplier reduced), `shadowBlur` set once per frame (not per bolt), `drawBolt` displacement ≤ 40, devicePixelRatio ≤ 1.5, and `speak()` rAF cancelled on play() rejection. Prevents main-thread saturation / unclickable UI under high-chaos moods.

### Verified
- Backend: chat (Anthropic claude-sonnet-4-6) + /api/voice/tts + upload/download all green.
- Frontend: builds clean; `/` and `/install` load with zero console errors.
- NOT headless-testable: passkey login + orb voice/mic flow (verified by code review).

### Next / Backlog
- **Markdown chat** (DONE): assistant replies render via react-markdown + remark-gfm (`Markdown.jsx`); per-message Speak button kept.
- **Orb redesign** (DONE): removed lightning; orb now pulses BRIGHTER with speech amplitude + thinking energy (radial halo/aura/core). Old `lightning` config repurposed as "Glow intensity" multiplier.
- **Fullscreen toggle** (DONE): `orb-fullscreen-button` uses Fullscreen API.
- **Debranded** (DONE): removed Made-with-Emergent badge, posthog, emergent-main.js, EMERGENT_LLM_KEY, testid refs; title='Promethius'.
- **Settings persistence** (DONE): provider/model now saved via PUT /api/settings + restored from /auth/me in Workspace and Orb (orb appearance & voice already persisted). 
- **Apply Changes / lock** (DONE): appearance Save button now "Apply Changes" → "Locked in" (green, disabled) until further edits.

- P1: split server.py + Orb.jsx into modules.
- P2: PWA manifest + service worker (installable/offline).
- P2: surface errors in enroll()/forget() (same silent-catch pattern).
- P3 (cosmetic): rename orb config key `lightning` → `glow`.
- P1: split server.py + Orb.jsx into modules.
- P2: PWA manifest + service worker (installable/offline).
- P2: same silent-catch anti-pattern remains in enroll()/forget() — surface errors there too.

## Live model status indicator (2026-06 — E1)
- Model dropdown (ChatPanel.jsx) now shows a per-provider reachability marker: green dot = online/reachable, red dot = offline/unreachable (distinct from the left-side green/yellow/red COST dots). Shown on each dropdown row (right of price), on the header model button, and explained in the dropdown legend (Online/Offline).
- Offline models are disabled (opacity-40, cursor-not-allowed, not selectable).
- Backend: new GET /api/models/status returns {openai, anthropic, ollama} booleans. openai/anthropic online if native key OR Emergent Universal Key present; ollama online only if the local tags endpoint responds. Verified endpoint registered (401 without auth).
- Status is fetched ONCE on launch in Workspace.jsx (api.get("/models/status")) per user's request (no polling).
- testids: model-status-current (header), model-status-<model> (each row).
- NOT headless-verified visually: dropdown sits behind WebAuthn passkey auth. Backend endpoint + frontend compile verified.
