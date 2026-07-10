#!/usr/bin/env bash
# deploy.sh — Deploy PITAS to production
# Usage: bash deploy.sh
#
# What it does:
#   1. Pulls latest code from main
#   2. Syncs files to /opt/pitas/ (preserves .env, data/, logs/, snapshots/)
#   3. Installs new dependencies if package.json changed
#   4. Restarts PM2 process

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="/opt/pitas"
PM2_NAME="pitas-web"

echo "🚀 PITAS Deploy"
echo "   Repo:   $REPO_DIR"
echo "   Deploy: $DEPLOY_DIR"
echo ""

# 1. Ensure we're on main and up to date
echo "→ Pulling latest from origin/main..."
cd "$REPO_DIR"
git checkout main 2>/dev/null
git pull origin main

echo ""
echo "→ Syncing to $DEPLOY_DIR..."

# 2. Rsync — exclude .env, data/, logs/, snapshots/, node_modules/
rsync -av --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='snapshots/' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  "$REPO_DIR/" "$DEPLOY_DIR/"

# 3. Install deps if package.json changed
echo ""
echo "→ Checking for dependency changes..."
cd "$DEPLOY_DIR"
if git diff --name-only HEAD~1 2>/dev/null | grep -q 'package.json' || [ ! -d node_modules ]; then
  echo "   package.json changed or node_modules missing — running npm install..."
  npm install --production
else
  echo "   No dependency changes."
fi

# 4. Restart PM2
echo ""
echo "→ Restarting PM2 process: $PM2_NAME..."
pm2 stop "$PM2_NAME" 2>/dev/null || true
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
# Health check with retries
for i in 1 2 3 4 5; do
  HEALTH=$(curl -sf http://localhost:${PORT:-3001}/api/health 2>/dev/null)
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "✅ Deploy complete — health: $HEALTH"
    exit 0
  fi
  echo "  Waiting for server... ($i/5)"
  sleep 2
done

echo "⚠️  Server started but health check failed. Check: pm2 logs $PM2_NAME --lines 10"
exit 1
