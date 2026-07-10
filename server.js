const express = require('express');
const path = require('path');
const db = require('./lib/db');
const api = require('./lib/api');
const config = require('./lib/config');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust first proxy (nginx reverse proxy)
app.set('trust proxy', 1);

// ─── Static files ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API routes ─────────────────────────────────────────────────
app.use(api);

// ─── Frontend routes ────────────────────────────────────────────
// Unsubscribe page — serves the same index.html, JS handles routing
app.get('/unsubscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/unsubscribe/:token', (req, res) => {
  // Direct unsubscribe from email link — handled by API
  // But serve frontend for the token route
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start server ───────────────────────────────────────────────
db.init();

app.listen(PORT, () => {
  console.log(`[server] PITAS running on http://localhost:${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
  console.log(`[server] Register: http://localhost:${PORT}/`);
  console.log(`[server] Unsubscribe: http://localhost:${PORT}/unsubscribe`);
});

// ─── Error handling ─────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  // Log and stay alive — PM2 will restart if we do crash
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});
