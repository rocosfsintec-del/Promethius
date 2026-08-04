#!/usr/bin/env bash
# Promethius one-command launcher (macOS / Linux)
# Boots MongoDB, the FastAPI backend, and the React frontend together.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "🔥 Starting Promethius..."

# 1) MongoDB ----------------------------------------------------------------
if ! pgrep -x mongod >/dev/null 2>&1; then
  echo "→ Starting MongoDB..."
  if command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q mongodb-community; then
    brew services start mongodb-community
  elif command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start mongod || true
  else
    mkdir -p "$ROOT/.mongo-data"
    mongod --dbpath "$ROOT/.mongo-data" --fork --logpath "$ROOT/.mongo-data/mongod.log" || true
  fi
else
  echo "→ MongoDB already running."
fi

# 2) Backend ----------------------------------------------------------------
echo "→ Starting backend (http://localhost:8001)..."
cd "$ROOT/backend"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install -q -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload &
BACKEND_PID=$!
deactivate 2>/dev/null || true

# 3) Frontend ---------------------------------------------------------------
echo "→ Starting frontend (http://localhost:3000)..."
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  yarn install
fi
yarn start &
FRONTEND_PID=$!

# Clean shutdown on Ctrl-C ---------------------------------------------------
trap 'echo; echo "Stopping Promethius..."; kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null' EXIT INT TERM

echo
echo "✅ Promethius is up. Open http://localhost:3000  (Ctrl-C to stop)"
wait
