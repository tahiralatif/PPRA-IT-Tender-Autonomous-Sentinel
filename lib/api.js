const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const config = require('./config');
const emailer = require('./emailer');
const scraper = require('./scraper');
const classify = require('./classify');

const router = express.Router();

// ─── Rate Limiting ──────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 registrations per hour per IP
  message: { error: 'Too many registrations, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const unsubLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 unsub requests per hour per IP
  message: { error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const checkNowLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 check-now requests per hour per IP
  message: { error: 'Rate limited. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── POST /api/register ─────────────────────────────────────────
// Register a new user. Creates unverified user, returns verify token.
router.post('/api/register', registerLimiter, (req, res) => {
  try {
    const { email, filters } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalized = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Check if already registered
    const existing = db.getUserByEmail(normalized);
    if (existing) {
      if (existing.verified) {
        return res.status(409).json({ error: 'Email already registered and verified' });
      }
      // Unverified — re-register (generate new tokens)
      // Delete old record and re-create
      db.getDb().prepare('DELETE FROM users WHERE email = ?').run(normalized);
    }

    const result = db.registerUser(normalized, filters || {});
    const siteUrl = config.siteUrl;

    const verifyUrl = `${siteUrl}/api/verify/${result.verifyToken}`;
    const unsubscribeUrl = `${siteUrl}/unsubscribe/${result.unsubscribeToken}`;

    console.log(`[api] Registered: ${normalized} → verify: ${verifyUrl}`);

    // Send verification email (async, don't block response)
    emailer.sendVerification({
      email: normalized,
      verify_token: result.verifyToken,
    }).catch(err => console.error('[api] Verification email failed:', err.message));

    res.status(201).json({
      message: 'Registration successful. Please check your email to verify.',
    });
  } catch (err) {
    console.error('[api] Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── GET /api/verify/:token ─────────────────────────────────────
// Verify a user's email address.
router.get('/api/verify/:token', (req, res) => {
  try {
    const { token } = req.params;
    const verified = db.verifyUser(token);

    if (verified) {
      res.send(`
        <html><head><title>All Set!</title></head>
        <body style="font-family:system-ui;max-width:500px;margin:80px auto;text-align:center">
          <h1>✅ All Set!</h1>
          <p>You're all set! You'll now receive daily IT tender alerts.</p>
          <p><a href="/pitas">← View Latest Tenders</a></p>
        </body></html>
      `);
    } else {
      res.status(404).send(`
        <html><head><title>Invalid Link</title></head>
        <body style="font-family:system-ui;max-width:500px;margin:80px auto;text-align:center">
          <h1>❌ Invalid or Expired Link</h1>
          <p>This verification link is invalid or has already been used.</p>
          <p><a href="/pitas">← Back to Home</a></p>
        </body></html>
      `);
    }
  } catch (err) {
    console.error('[api] Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── POST /api/unsubscribe ──────────────────────────────────────
// Request unsubscribe — sends confirmation link (prevents link scanner false-unsubscribes)
router.post('/api/unsubscribe', unsubLimiter, (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = db.getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      // Don't reveal whether email exists
      return res.json({ message: 'If that email is registered, you\'ll receive an unsubscribe link.' });
    }

    const siteUrl = config.siteUrl;
    const unsubscribeUrl = `${siteUrl}/unsubscribe/${user.unsubscribe_token}`;

    // TODO: Send unsubscribe confirmation email via Resend (Task 6)
    console.log(`[api] Unsubscribe requested: ${email.toLowerCase().trim()} → ${unsubscribeUrl}`);

    // Send unsubscribe confirmation email (async)
    emailer.sendUnsubConfirmation({
      email: email.toLowerCase().trim(),
      unsubscribe_token: user.unsubscribe_token,
    }).catch(err => console.error('[api] Unsub email failed:', err.message));

    res.json({
      message: 'If that email is registered, you\'ll receive an unsubscribe link.',
    });
  } catch (err) {
    console.error('[api] Unsubscribe request error:', err.message);
    res.status(500).json({ error: 'Request failed' });
  }
});

// ─── GET /api/unsubscribe/:token ────────────────────────────────
// One-click unsubscribe (from email link)
router.get('/api/unsubscribe/:token', (req, res) => {
  try {
    const { token } = req.params;
    const unsubscribed = db.unsubscribeUser(token);

    if (unsubscribed) {
      res.send(`
        <html><head><title>Unsubscribed</title></head>
        <body style="font-family:system-ui;max-width:500px;margin:80px auto;text-align:center">
          <h1>📭 Unsubscribed</h1>
          <p>You won't receive any more tender alerts.</p>
          <p>Changed your mind? <a href="/pitas/">Re-register here</a>.</p>
        </body></html>
      `);
    } else {
      res.status(404).send(`
        <html><head><title>Invalid Link</title></head>
        <body style="font-family:system-ui;max-width:500px;margin:80px auto;text-align:center">
          <h1>❌ Invalid or Expired Link</h1>
          <p>This unsubscribe link is invalid or has already been used.</p>
          <p><a href="/pitas/">← Back to registration</a></p>
        </body></html>
      `);
    }
  } catch (err) {
    console.error('[api] Unsubscribe error:', err.message);
    res.status(500).json({ error: 'Unsubscribe failed' });
  }
});

// ─── GET /api/check-now ────────────────────────────────────────
// On-demand check: returns IT-relevant tenders. Scrapes if data is stale.
router.get('/api/check-now', checkNowLimiter, async (req, res) => {
  const startTime = Date.now();
  try {
    // Check if last scrape was within 30 minutes
    const d = db.getDb();
    const lastRun = d.prepare(
      `SELECT finished_at FROM run_log ORDER BY id DESC LIMIT 1`
    ).get();

    const thirtyMinMs = 30 * 60 * 1000;

    if (lastRun && lastRun.finished_at) {
      const lastRunTime = new Date(lastRun.finished_at + 'Z').getTime();
      const age = Date.now() - lastRunTime;

      if (age < thirtyMinMs) {
        // Data is fresh — return from DB
        const tenders = db.getOpenRelevantTenders();
        return res.json({
          tenders: tenders.map(formatTender),
          cached: true,
          scrape_duration_ms: 0,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // No recent run — run the full scrape+classify pipeline
    console.log('[check-now] Stale data, running full pipeline...');
    const scrapeStart = Date.now();

    // Step 1: Scrape
    let scrapeResults;
    try {
      scrapeResults = await scraper.scrapeAll();
    } catch (err) {
      console.error('[check-now] Scrape failed:', err.message);
      return res.status(500).json({
        error: 'Scrape failed: ' + err.message,
        tenders: [],
        cached: false,
        scrape_duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }

    const allTenders = [...scrapeResults.epms, ...scrapeResults.epads];

    // Step 2: Classify (with graceful fallback if Groq is down)
    let classified;
    try {
      classified = await classify.classifyBatch(allTenders);
    } catch (err) {
      console.error('[check-now] Classification failed, falling back to keyword-only:', err.message);
      // Fallback: classify by keywords only
      const relevant = [];
      const excluded = [];
      for (const t of allTenders) {
        const kw = classify.classifyByKeywords(t);
        if (kw && kw.relevant) {
          relevant.push({ ...t, classification: kw });
        } else {
          excluded.push({ ...t, classification: kw || { relevant: false, reason: 'AI unavailable', method: 'ai-fallback' } });
        }
      }
      classified = {
        relevant,
        excluded,
        stats: { include: relevant.length, exclude: excluded.length, ai: 0 },
      };
    }

    // Step 3: Store in DB
    const relevantTenders = classified.relevant;
    const stats = db.upsertBatch(relevantTenders);

    // Step 4: Log the run
    const scrapeDurationMs = Date.now() - scrapeStart;
    db.logRun({
      startedAt: new Date(scrapeStart).toISOString(),
      source: 'check-now',
      tendersScraped: allTenders.length,
      relevantCount: relevantTenders.length,
      newCount: stats.new,
      updatedCount: stats.updated,
      durationMs: scrapeDurationMs,
    });

    console.log(`[check-now] Pipeline complete: ${relevantTenders.length} relevant, ${scrapeDurationMs}ms`);

    res.json({
      tenders: relevantTenders.map(formatTender),
      cached: false,
      scrape_duration_ms: scrapeDurationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[check-now] Unexpected error:', err.message);
    res.status(500).json({
      error: 'Internal error: ' + err.message,
      tenders: [],
      cached: false,
      scrape_duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  }
});

/** Format a tender object for the API response */
function formatTender(t) {
  return {
    id: t.id,
    title: t.title,
    department: t.department || '',
    category: t.category || '',
    closing_date: t.closing_date || '',
    url: t.url || '',
    source: t.source || '',
    classification_reason: t.classification_reason || '',
    classification_method: t.classification_method || '',
  };
}

// ─── GET /api/health ────────────────────────────────────────────
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── GET /api/stats ─────────────────────────────────────────────
// Public stats for the landing page
router.get('/api/stats', (req, res) => {
  try {
    const d = db.getDb();
    const totalTenders = d.prepare('SELECT COUNT(*) as count FROM tenders WHERE is_it_relevant = 1').get().count;
    const openTenders = d.prepare(`SELECT COUNT(*) as count FROM tenders WHERE is_it_relevant = 1 AND (closing_date = '' OR closing_date IS NULL OR closing_date > datetime('now'))`).get().count;
    const totalUsers = d.prepare('SELECT COUNT(*) as count FROM users WHERE verified = 1').get().count;
    const recentRuns = d.prepare('SELECT COUNT(*) as count FROM run_log').get().count;

    res.json({
      tenders: { total: totalTenders, open: openTenders },
      users: totalUsers,
      runs: recentRuns,
    });
  } catch (err) {
    res.json({ tenders: { total: 0, open: 0 }, users: 0, runs: 0 });
  }
});

module.exports = router;
