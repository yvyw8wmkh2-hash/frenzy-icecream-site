#!/usr/bin/env bash
# (Re)start the Frenzy site in the background. Usage: ./start.sh
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
export PORT="${PORT:-8080}" HOST="${HOST:-0.0.0.0}"
pkill -f "node $(pwd)/server.js" 2>/dev/null; sleep 0.5
mkdir -p logs
nohup node "$(pwd)/server.js" >> logs/server.log 2>&1 &
echo "Started PID $! on http://localhost:$PORT (logs: logs/server.log)"
