# Promethius — Changelog

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
