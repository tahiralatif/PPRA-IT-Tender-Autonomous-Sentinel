const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db;

/**
 * Initialize database — creates tables if they don't exist
 */
function init() {
  const dbDir = path.dirname(config.db.path);
  fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Core tender storage
    CREATE TABLE IF NOT EXISTS tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,              -- 'epms' or 'epads'
      tender_ref TEXT NOT NULL,          -- portal's tender ID/reference
      title TEXT NOT NULL,
      department TEXT,
      category TEXT,
      sector TEXT,
      closing_date TEXT,
      url TEXT NOT NULL,
      description TEXT,
      is_it_relevant INTEGER DEFAULT 0,
      classification_method TEXT,
      classification_reason TEXT,
      content_hash TEXT NOT NULL,        -- SHA-256 of title+description
      discovered_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source, tender_ref)
    );

    -- Registered users
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      filters TEXT DEFAULT '{}',
      verified INTEGER DEFAULT 0,
      verify_token TEXT,
      unsubscribe_token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Sent log — prevents duplicate emails + tracks updates
    CREATE TABLE IF NOT EXISTS sent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tender_id INTEGER NOT NULL,
      content_hash_at_send TEXT NOT NULL,
      was_update INTEGER DEFAULT 0,
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tender_id) REFERENCES tenders(id),
      UNIQUE(user_id, tender_id)
    );

    -- Raw HTML snapshots for debugging
    CREATE TABLE IF NOT EXISTS scrape_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      raw_html TEXT,
      scraped_at TEXT DEFAULT (datetime('now'))
    );

    -- Run history for monitoring
    CREATE TABLE IF NOT EXISTS run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      source TEXT,
      tenders_scraped INTEGER DEFAULT 0,
      relevant_count INTEGER DEFAULT 0,
      new_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      emails_sent INTEGER DEFAULT 0,
      errors TEXT,
      duration_ms INTEGER
    );
  `);

  console.log(`[db] Database initialized: ${config.db.path}`);
  return db;
}

/**
 * Get the database instance (init if needed)
 */
function getDb() {
  if (!db) init();
  return db;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Normalize a date string to ISO format (YYYY-MM-DD HH:MM:SS)
 * Handles: "Jul 24, 2026 10:00 AM", "2026-07-24", "21h 1m Left" etc.
 * Returns empty string if unparseable.
 */
function normalizeDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // Already ISO format?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;

  // Relative time like "21h 1m Left" — can't normalize, return as-is
  if (/\d+[hm]\s*\d*[hm]?\s*left/i.test(trimmed)) return '';

  try {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace('T', ' ').replace('.000Z', '');
  } catch (e) {
    return '';
  }
}

// ─── Content Hash ───────────────────────────────────────────────

/**
 * Generate a content hash for dedup/update detection
 * Hashes title + description (normalized)
 */
function contentHash(tender) {
  const normalized = [
    (tender.title || '').trim().toLowerCase(),
    (tender.description || '').trim().toLowerCase(),
  ].join('|||');

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ─── Tender Operations ──────────────────────────────────────────

/**
 * Store a tender. Returns { id, isNew, isUpdated }
 * - If tender doesn't exist → INSERT, return { isNew: true }
 * - If tender exists with same hash → update last_seen_at, return { isNew: false }
 * - If tender exists with different hash → update fields, return { isUpdated: true }
 */
function upsertTender(tender) {
  const d = getDb();
  const hash = contentHash(tender);

  // Check if tender already exists
  const tenderRef = tender.tenderRef || tender.tenderId;
  const existing = d
    .prepare('SELECT id, content_hash, closing_date FROM tenders WHERE source = ? AND tender_ref = ?')
    .get(tender.source, tenderRef);

  if (!existing) {
    // New tender — insert
    const stmt = d.prepare(`
      INSERT INTO tenders (source, tender_ref, title, department, category, sector, closing_date, url, description, is_it_relevant, classification_method, classification_reason, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      tender.source,
      tenderRef,
      tender.title || '',
      tender.department || tender.organization || '',
      tender.category || '',
      tender.sector || '',
      normalizeDate(tender.closingDate),
      tender.url || '',
      tender.description || '',
      tender.isITRelevant || tender.classification?.relevant ? 1 : 0,
      tender.classification?.method || null,
      tender.classification?.reason || null,
      hash
    );

    return { id: result.lastInsertRowid, isNew: true, isUpdated: false };
  }

  // Existing tender — check for content changes AND closing date changes
  const oldClosingDate = existing.closing_date;
  const newClosingDate = normalizeDate(tender.closingDate);
  const contentChanged = existing.content_hash !== hash;
  let deadlineChanged = false;
  let deadlineDirection = null; // 'extended' or 'shortened'

  // Always check for closing date changes (regardless of content hash)
  if (oldClosingDate && newClosingDate && oldClosingDate !== newClosingDate) {
    deadlineChanged = true;
    try {
      const oldDate = new Date(oldClosingDate);
      const newDate = new Date(newClosingDate);
      if (!isNaN(oldDate) && !isNaN(newDate)) {
        deadlineDirection = newDate > oldDate ? 'extended' : 'shortened';
      }
    } catch (e) {
      // Date parsing failed — still flag as changed
    }
  }

  // If nothing changed, just update last_seen_at
  if (!contentChanged && !deadlineChanged) {
    d.prepare(`UPDATE tenders SET last_seen_at = datetime('now') WHERE id = ?`)
      .run(existing.id);
    return { id: existing.id, isNew: false, isUpdated: false };
  }

  // Something changed — update the tender record
  d.prepare(`UPDATE tenders
    SET title = ?, department = ?, category = ?, sector = ?, closing_date = ?,
        description = ?, is_it_relevant = ?, classification_method = ?,
        classification_reason = ?, content_hash = ?, last_seen_at = datetime('now')
    WHERE id = ?
  `).run(
    tender.title || '',
    tender.department || tender.organization || '',
    tender.category || '',
    tender.sector || '',
    newClosingDate,
    tender.description || '',
    tender.isITRelevant || tender.classification?.relevant ? 1 : 0,
    tender.classification?.method || null,
    tender.classification?.reason || null,
    hash,
    existing.id
  );

  return {
    id: existing.id,
    isNew: false,
    isUpdated: true,
    deadlineChanged,
    deadlineDirection,
    oldClosingDate: deadlineChanged ? oldClosingDate : null,
    newClosingDate: deadlineChanged ? newClosingDate : null,
  };
}

/**
 * Batch upsert tenders — returns stats
 */
function upsertBatch(tenders) {
  const stats = { new: 0, updated: 0, unchanged: 0, errors: 0 };

  for (const tender of tenders) {
    try {
      const result = upsertTender(tender);
      if (result.isNew) stats.new++;
      else if (result.isUpdated) stats.updated++;
      else stats.unchanged++;
    } catch (err) {
      console.error(`[db] Error upserting ${tender.source}/${tender.tenderRef || tender.tenderId}: ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`[db] Batch upsert: ${stats.new} new, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.errors} errors`);
  return stats;
}

/**
 * Get all IT-relevant tenders that are still open (closing date in future)
 */
function getOpenRelevantTenders() {
  const d = getDb();
  return d
    .prepare(`
      SELECT * FROM tenders
      WHERE is_it_relevant = 1
        AND (closing_date = '' OR closing_date IS NULL OR closing_date > datetime('now'))
      ORDER BY closing_date ASC
    `)
    .all();
}

/**
 * Get recent tenders (last N days)
 */
function getRecentTenders(days = 7) {
  const d = getDb();
  return d
    .prepare(`
      SELECT * FROM tenders
      WHERE discovered_at >= datetime('now', '-' || ? || ' days')
      ORDER BY discovered_at DESC
    `)
    .all(days);
}

/**
 * Get tender by ID
 */
function getTenderById(id) {
  const d = getDb();
  return d.prepare('SELECT * FROM tenders WHERE id = ?').get(id);
}

// ─── User Operations ────────────────────────────────────────────

const crypto_random = () => crypto.randomBytes(32).toString('hex');

/**
 * Register a new user. Returns { id, verifyToken, unsubscribeToken }
 */
function registerUser(email, filters = {}) {
  const d = getDb();
  const verifyToken = crypto_random();
  const unsubscribeToken = crypto_random();

  const stmt = d.prepare(`
    INSERT INTO users (email, filters, verify_token, unsubscribe_token)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(email.toLowerCase().trim(), JSON.stringify(filters), verifyToken, unsubscribeToken);
  return { id: result.lastInsertRowid, verifyToken, unsubscribeToken };
}

/**
 * Verify a user by token
 */
function verifyUser(token) {
  const d = getDb();
  const result = d.prepare('UPDATE users SET verified = 1 WHERE verify_token = ?').run(token);
  return result.changes > 0;
}

/**
 * Unsubscribe a user by token (soft-delete)
 */
function unsubscribeUser(token) {
  const d = getDb();
  const result = d.prepare('UPDATE users SET verified = 0 WHERE unsubscribe_token = ?').run(token);
  return result.changes > 0;
}

/**
 * Get user by email
 */
function getUserByEmail(email) {
  const d = getDb();
  return d.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

/**
 * Get user by unsubscribe token
 */
function getUserByUnsubscribeToken(token) {
  const d = getDb();
  return d.prepare('SELECT * FROM users WHERE unsubscribe_token = ?').get(token);
}

/**
 * Get all verified users
 */
function getVerifiedUsers() {
  const d = getDb();
  return d.prepare('SELECT * FROM users WHERE verified = 1').all();
}

// ─── Sent Log Operations ────────────────────────────────────────

/**
 * Log that a tender was sent to a user. Returns true if new, false if already sent.
 */
function logSent(userId, tenderId, contentHash, wasUpdate = false) {
  const d = getDb();
  try {
    d.prepare(`
      INSERT INTO sent_log (user_id, tender_id, content_hash_at_send, was_update)
      VALUES (?, ?, ?, ?)
    `).run(userId, tenderId, contentHash, wasUpdate ? 1 : 0);
    return true;
  } catch (err) {
    // UNIQUE constraint — already sent
    if (err.message.includes('UNIQUE')) {
      return false;
    }
    throw err;
  }
}

/**
 * Get tenders that need to be sent to a user
 * (not yet in sent_log, or updated since last send)
 */
function getTendersForUser(userId) {
  const d = getDb();
  return d
    .prepare(`
      SELECT t.*, sl.content_hash_at_send, sl.was_update, sl.sent_at
      FROM tenders t
      LEFT JOIN sent_log sl ON sl.tender_id = t.id AND sl.user_id = ?
      WHERE t.is_it_relevant = 1
        AND (sl.id IS NULL OR sl.content_hash_at_send != t.content_hash)
      ORDER BY t.discovered_at DESC
    `)
    .all(userId);
}

// ─── Run Log Operations ─────────────────────────────────────────

/**
 * Log a pipeline run
 */
function logRun(stats) {
  const d = getDb();
  d.prepare(`
    INSERT INTO run_log (started_at, finished_at, source, tenders_scraped, relevant_count, new_count, updated_count, emails_sent, errors, duration_ms)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stats.startedAt || new Date().toISOString(),
    stats.source || 'all',
    stats.tendersScraped || 0,
    stats.relevantCount || 0,
    stats.newCount || 0,
    stats.updatedCount || 0,
    stats.emailsSent || 0,
    stats.errors || null,
    stats.durationMs || 0
  );
}

/**
 * Get last N runs for monitoring
 */
function getRecentRuns(limit = 10) {
  const d = getDb();
  return d.prepare('SELECT * FROM run_log ORDER BY started_at DESC LIMIT ?').all(limit);
}

// ─── Snapshot Operations ─────────────────────────────────────────

/**
 * Store a raw HTML snapshot for debugging
 */
function saveSnapshot(source, rawHtml) {
  const d = getDb();
  d.prepare('INSERT INTO scrape_snapshots (source, raw_html) VALUES (?, ?)').run(source, rawHtml);
}

/**
 * Get recent snapshots for debugging
 */
function getRecentSnapshots(source, limit = 5) {
  const d = getDb();
  if (source) {
    return d.prepare('SELECT id, source, length(raw_html) as html_size, scraped_at FROM scrape_snapshots WHERE source = ? ORDER BY scraped_at DESC LIMIT ?').all(source, limit);
  }
  return d.prepare('SELECT id, source, length(raw_html) as html_size, scraped_at FROM scrape_snapshots ORDER BY scraped_at DESC LIMIT ?').all(limit);
}

/**
 * Prune snapshots older than N days
 */
function pruneSnapshots(days = 30) {
  const d = getDb();
  const modifier = `-${Math.abs(days)} days`;
  const result = d.prepare(`DELETE FROM scrape_snapshots WHERE scraped_at < datetime('now', ?)`).run(modifier);
  if (result.changes > 0) {
    console.log(`[db] Pruned ${result.changes} old snapshots`);
  }
  return result.changes;
}

// ─── Cleanup ────────────────────────────────────────────────────

/**
 * Close database connection
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  getDb,
  close,
  contentHash,
  upsertTender,
  upsertBatch,
  getOpenRelevantTenders,
  getRecentTenders,
  getTenderById,
  registerUser,
  verifyUser,
  unsubscribeUser,
  getUserByEmail,
  getUserByUnsubscribeToken,
  getVerifiedUsers,
  logSent,
  getTendersForUser,
  logRun,
  getRecentRuns,
  saveSnapshot,
  getRecentSnapshots,
  pruneSnapshots,
};
