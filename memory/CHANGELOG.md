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

## Key Validation UI + Session Total Cost (2026-06 — E1)
- **Key Validation UI** (VoiceSettings.jsx ApiKeysTab): each SAVED key now shows a live verification badge — green "verified" (CheckCircle2) when the key validates against its provider, red "invalid/failed" (XCircle) when not, "saved" for non-verifiable providers (fal.ai). Added a "Re-verify" button (reverify-keys-button). Runs on tab load and after save/clear. testids: apikey-verify-<id>.
- Backend: GET /api/settings/keys/verify live-validates saved keys concurrently (asyncio.gather, 8s timeout): openai GET /v1/models, anthropic GET /v1/models, elevenlabs GET /v1/user, resend GET /domains, tavily GET /usage. 200=valid; 400/401/403=invalid; fal has no free check → {verifiable:false}. Verified via curl (stale elevenlabs/tavily keys correctly flagged invalid).
- **Session Total Cost** (ChatPanel.jsx): chat header now shows a running "Session ~$0.00xx" (or "Session Free" for local/ollama) chip once the conversation has ≥1 message, summing estimated cost across all assistant messages at current model rates. testid: session-cost.
- Polish: fmtCost now renders sub-$0.0001 totals as "<$0.0001" instead of "$0.00000".
- Verified: testing agent iteration_25 — 100% frontend pass, all flows (passkey login via CDP virtual authenticator, dropdown status markers, verify badges, session cost chip), zero console errors.

## GitHub self-push fix + hang-proof updater (2026-10 — E1)
- ROOT CAUSE of "No files provided to push": the chat model had to inline entire file contents into propose_github_push tool-call JSON; with max_tokens=8192 large files (Orb.jsx ~23KB) truncated → invalid JSON → args dropped → empty files. Small files worked.
- FIX A (server.py): new tool `propose_self_update(paths?, message, branch, open_pr)` — backend reads real file content from DISK (no LLM inlining), works for any file size. Wired into _exec_gh_tool + _make_self_update_proposal(); proposal detection in both openai/anthropic tool loops now keys off result.get("proposal"). Raised tool-call max_tokens 8192→16000. Graceful handling when tool args fail to parse (tells model it truncated + to use propose_self_update / one small file per call). GH_TOOL_GUIDANCE updated: always use propose_self_update for 'update yourself'. Friendlier "GitHub not connected" error (was raw 'token_enc' KeyError). Raised _SELF_MAX_FILE_BYTES 120KB→500KB (server.py is 120KB, was being skipped) and bundle 3MB→5MB.
- update-promethius.bat: fixed two hangs/corruptions. (1) [3/6] removed network `git remote set-head origin -a` (hung over SSH) — now derives branch locally, falls back to main; added GIT_TERMINAL_PROMPT=0 + GIT_SSH_COMMAND BatchMode/accept-new/ConnectTimeout so git/ssh never block on prompts. (2) self-relaunch from %TEMP% so `git reset --hard` can overwrite the running .bat without cmd.exe re-reading a corrupted offset ("system cannot find path specified" + repeated lines).
- Verified: model selects propose_self_update for "update yourself"; friendly token error; disk-read returns FULL content for Orb.jsx/ChatPanel.jsx/server.py. Deployed to user's local (HEAD 3c02509), Select-String confirms tool live. User decision: NO scheduled auto-push — push is triggered by Promethius (chat tool) or manually (GitHub button). Final live push pending user test with their PAT.

## Fixed broken "Update" icon in left panel (2026-10 — E1)
- ROOT CAUSE: Promethius (the chat model) had built the UpdateButton UI in Sidebar.jsx that POSTed to /api/system/update expecting an SSE 6-step stream — but that backend endpoint never existed, so every click 404'd → "Err". (Also used wrong localStorage token key.)
- FIX (backend server.py): new POST /api/system/update — admin-only; guards: must be a git clone (.git), must be Windows (os.name=='nt') with update-promethius.bat present, else returns a clear message. Launches the updater detached (cmd /c start) so it survives the backend restart; returns {started:true} immediately. Verified via curl: admin passes role+git checks then Windows guard fires on Linux preview; 401 unauth.
- FIX (frontend Sidebar.jsx): rewrote UpdateButton — admin-only (gated with user.role==='admin'), uses the api axios instance (correct auth), states idle→starting(spinner)→restarting(green "Reload", click reloads page)→error. No SSE stream (incompatible with self-restart). Kept in the tools grid per user. testid: update-promethius-button.
- User choices: admin-only; manual click-to-reload (no auto-reload); icon stays in tools grid.
- NOTE: this is a FRONTEND change, so deploy needs yarn build this round (unlike fix A). Windows launch not testable from Linux preview; endpoint guards + compile verified.

## Orb replaced with user's WebGL plasma shader (2026-10 — E1)
- Replaced the 2D-canvas orb renderer in Orb.jsx useOrbCanvas with the user's WebGL plasma-sphere fragment shader (filaments via fbm, bright core, limb shading, outer flame band). Kept the same hook signature so the rest of Orb.jsx (voice/state/flash/standby refs) is unchanged.
- Made ALL orb settings functional by binding them to shader uniforms: color->uHue (hueRotate from base blue 210deg), tipColor->uTipHue (outer flames), size->uSize(R), density->uDensity, chaos->uChaos (turbulence/speed), lightning->uGlow (brightness), floatSpeed->uFloat (bob), idle->resting uEnergy. Live: energyRef->uEnergy, voiceRef->uVoice+uFlare, state activity->uState, flash->green hue+glow boost, standby->dim. Moods are presets of these.
- Verified: standalone WebGL test page (public/orbtest.html, since removed) rendered with zero shader/link errors; hue rotation + filaments + core + flame band all correct. Frontend compiles (1 pre-existing warning).
- Source of truth is now /app Orb.jsx so Save-to-GitHub preserves it (won't be overwritten again).
- DEPLOY: frontend change -> needs yarn build.

## memory_engine rebuilt — syntax-verified, crash-proof (2026-10 — E1)
- CONTEXT: a Promethius self-update had added memory_engine with an unmatched ')' on server.py line 762 → backend wouldn't start → passkey/login failed (ERR_CONNECTION_REFUSED). User rolled local back to 451f684 to restore login.
- Rebuilt backend/memory_engine.py as PURE stdlib-only helpers (no DB, no 3rd-party imports) so importing it can never crash the backend: categorize, score_memory (importance+recall+recency+query overlap), rank_memories, search_memories, format_memory_block, compute_stats, enrich_on_store.
- server.py wiring (all defensive, guarded import `import memory_engine as _mem`, every call try/except with legacy fallback): build_system_prompt now uses _recall_block() → ranked memory injection + best-effort recall_count $inc; extract_and_store_memory + manual add_memory enrich new rows with category/importance/recall_count; new GET /api/memory/search?q= and GET /api/memory/stats.
- Verified: ast.parse both files OK; imported and unit-exercised memory_engine (rank/search/categorize/stats/enrich correct); backend boots clean; curl /memory/stats, /memory/search, and /chat (exercises build_system_prompt) all 200. BACKEND-ONLY → no yarn build needed.
- Deploy: Save to GitHub → git fetch origin → git reset --hard origin/main → restart backend. (Save-to-GitHub overwrites the broken self-pushed memory commits with this verified version.)

## Memory panel upgrade + push syntax-guard + importance editing (2026-10 — E1)
- Backend: new `PATCH /api/memory/{mid}` (importance 1-5 clamped, optional content edit with re-categorize). Verified via curl.
- Backend: `_validate_push_files()` runs ast.parse on .py and json.loads on .json for every push; wired into BOTH `_make_self_update_proposal` and the `propose_github_push` handler — a push that would break the app is now REFUSED with a clear per-file message. Verified: catches unmatched ')' and bad JSON (prevents repeat of the login outage).
- Frontend RightPanel Memory(): stats card (total/recalls/auto/manual), live search box, category filter chips with counts, per-memory category + source badges + recall-count, and editable 5-dot importance bars (optimistic update → PATCH). testids: memory-stats, memory-search, memory-cat-<c>, memory-importance, importance-dot-<n>.
- Verified: server ast OK + boots clean; add/patch/stats/search endpoints 200; validator unit-tested; frontend compiles (1 pre-existing warning).
- Deploy: FRONTEND changed → Save to GitHub → git fetch → git reset --hard origin/main → cd frontend → yarn.cmd build → restart backend.

## Login "Restore last good" + auto-fix-on-reject guidance (2026-10 — E1)
- Backend records last-good commit (git HEAD) to backend/.last_good_commit at the END of a clean startup — a crashing commit never overwrites a working one.
- New POST /api/system/restore: intentionally NO auth (recover-when-locked-out), hard-gated to localhost request + Windows git clone; reads .last_good_commit and launches restore-promethius.bat detached. Verified: 403 from proxy, passes guard from localhost. Added `Request` to fastapi import.
- New restore-promethius.bat: self-relaunch from TEMP, GIT batch-mode env, reset --hard <last_good>, rebuild, restart (same hardening as updater).
- Frontend Auth.jsx login screen: "Restore last good version" button (data-testid restore-last-good) with confirm → POST /system/restore → toast.
- GH_TOOL_GUIDANCE: AUTO-FIX ON REJECTION — when a push returns 'Refusing to push' (syntax guard), the model must fix the listed file/line and re-call the push tool in the SAME turn, retrying until accepted; never claim success on a rejected push.
- Deploy: FRONTEND changed → Save to GitHub → git reset --hard origin/main → yarn.cmd build → restart backend.
