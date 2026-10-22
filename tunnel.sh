#!/usr/bin/env bash
# Start a temporary public HTTPS URL via Cloudflare quick tunnel. URL appears in logs/tunnel.log
cd "$(dirname "$0")"; mkdir -p logs
CF=$(command -v cloudflared || echo "$HOME/bin/cloudflared")
pkill -f "cloudflared tunnel --url" 2>/dev/null; sleep 0.5
: > logs/tunnel.log
nohup "$CF" tunnel --no-autoupdate --url "http://localhost:${PORT:-8080}" >> logs/tunnel.log 2>&1 &
for i in $(seq 1 30); do U=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | head -1); [ -n "$U" ] && break; sleep 1; done
echo "${U:-No URL yet – check logs/tunnel.log}"; [ -n "$U" ] && echo "$U" > logs/public-url.txt
