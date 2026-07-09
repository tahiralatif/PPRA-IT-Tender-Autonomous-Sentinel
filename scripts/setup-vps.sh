#!/bin/bash
# PITAS VPS Setup Script
# Run once on server.14.jugaar.ai to deploy the application
#
# Usage: bash setup-vps.sh
# Prerequisites: Node.js 18+, npm, PM2, git

set -e

echo "═══════════════════════════════════════"
echo "  PITAS VPS Deployment Setup"
echo "═══════════════════════════════════════"

# ─── Config ──────────────────────────────────────────────────
APP_DIR="/opt/pitas"
NODE_ENV="production"
PORT=3000

# ─── Step 1: System deps ────────────────────────────────────
echo ""
echo "📋 Step 1: Installing system dependencies..."

if ! command -v node &> /dev/null; then
  echo "  Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "  Node: $(node --version)"
echo "  npm: $(npm --version)"

if ! command -v pm2 &> /dev/null; then
  echo "  Installing PM2..."
  sudo npm install -g pm2
fi
echo "  PM2: $(pm2 --version 2>/dev/null || echo 'installed')"

# ─── Step 2: Clone app ──────────────────────────────────────
echo ""
echo "📋 Step 2: Setting up application..."

if [ -d "$APP_DIR" ]; then
  echo "  App directory exists, pulling latest..."
  cd "$APP_DIR"
  git pull
else
  echo "  Cloning repository..."
  sudo mkdir -p "$APP_DIR"
  sudo chown $(whoami) "$APP_DIR"
  git clone https://github.com/tahiralatif/PPRA-IT-Tender-Autonomous-Sentinel.git "$APP_DIR"
  cd "$APP_DIR"
fi

# ─── Step 3: Install deps ───────────────────────────────────
echo ""
echo "📋 Step 3: Installing dependencies..."
npm ci --production

# ─── Step 4: Configure .env ─────────────────────────────────
echo ""
echo "📋 Step 4: Configuring environment..."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ⚠️  Created .env from template — EDIT IT with real values:"
  echo "     nano $APP_DIR/.env"
  echo ""
  echo "  Required keys:"
  echo "    RESEND_API_KEY=re_..."
  echo "    SITE_URL=https://pitas.example.com"
  echo "    ADMIN_EMAIL=you@example.com"
else
  echo "  .env already exists, skipping"
fi

# ─── Step 5: Create dirs ────────────────────────────────────
echo ""
echo "📋 Step 5: Creating directories..."
mkdir -p data logs snapshots

# ─── Step 6: Initialize DB ──────────────────────────────────
echo ""
echo "📋 Step 6: Initializing database..."
node -e "require('./lib/db').init(); console.log('  ✅ Database initialized'); process.exit(0);"

# ─── Step 7: Start web server ───────────────────────────────
echo ""
echo "📋 Step 7: Starting web server with PM2..."
pm2 delete pitas-web 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# ─── Step 8: PM2 startup ────────────────────────────────────
echo ""
echo "📋 Step 8: Setting PM2 to start on boot..."
pm2 startup systemd -u $(whoami) --hp $(echo $HOME) 2>/dev/null || echo "  ⚠️  Run 'pm2 startup' manually if needed"

# ─── Step 9: Cron jobs ──────────────────────────────────────
echo ""
echo "📋 Step 9: Setting up cron jobs..."

CRON_FILE="/tmp/pitas-cron"
cat > "$CRON_FILE" << EOF
# PITAS Daily Runs (7 AM and 3 PM PKT = 2 AM and 8 AM UTC)
# UTC times: PKT is UTC+5
0 2 * * * cd $APP_DIR && /usr/bin/node scripts/daily-run.js >> logs/daily-run.log 2>&1
0 8 * * * cd $APP_DIR && /usr/bin/node scripts/daily-run.js >> logs/daily-run.log 2>&1

# Log rotation (weekly, Sunday midnight)
0 0 * * 0 bash $APP_DIR/scripts/rotate-logs.sh >> logs/rotate.log 2>&1
EOF

# Merge with existing crontab
(crontab -l 2>/dev/null | grep -v 'PITAS\|pitas'; cat "$CRON_FILE") | crontab -
rm "$CRON_FILE"
echo "  ✅ Cron jobs installed"

# ─── Step 10: Test ──────────────────────────────────────────
echo ""
echo "📋 Step 10: Testing..."
sleep 2
HEALTH=$(curl -s http://localhost:$PORT/api/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  ✅ Web server responding on port $PORT"
else
  echo "  ❌ Web server not responding — check PM2 logs"
fi

# ─── Done ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo "═══════════════════════════════════════"
echo ""
echo "  Web server: http://localhost:$PORT"
echo "  Health: http://localhost:$PORT/api/health"
echo "  PM2 status: pm2 status"
echo "  PM2 logs: pm2 logs pitas-web"
echo ""
echo "  ⚠️  TODO before going live:"
echo "  1. Edit $APP_DIR/.env with real API keys"
echo "  2. Configure nginx reverse proxy (if needed)"
echo "  3. Set up SSL (certbot)"
echo "  4. Configure Resend domain (SPF/DKIM/DMARC)"
echo "  5. Run: node scripts/seed-users.js --email=your@email.com"
echo "  6. Test pipeline: node scripts/daily-run.js --dry-run"
echo ""
