/**
 * Shared pipeline: scrape → classify → store → log
 *
 * Used by both:
 *   - Cron / daily-run.js (no rate limit, sends emails)
 *   - API /api/check-now (rate limited, no emails, returns JSON)
 */

const db = require('./db');
const scraper = require('./scraper');
const classify = require('./classify');

/**
 * Run the full scrape → classify → store pipeline.
 *
 * @param {Object} opts
 * @param {string}  opts.source       - 'all' | 'epms' | 'epads'
 * @param {boolean} opts.dryRun       - If true, skip email sending (handled by caller)
 * @param {function} opts.onProgress  - Optional callback(msg) for logging
 * @returns {Object} pipeline results with stats
 */
async function runPipeline({ source = 'all', dryRun = false, onProgress } = {}) {
  const log = onProgress || (() => {});
  const startTime = Date.now();

  const stats = {
    startedAt: new Date().toISOString(),
    source,
    tendersScraped: 0,
    relevantCount: 0,
    newCount: 0,
    updatedCount: 0,
    emailsSent: 0,
    errors: [],
    tenders: [],       // relevant tenders for email/notification
    updatedTenders: [], // tenders with deadline changes
    durationMs: 0,
  };

  // ─── Step 1: Scrape ───────────────────────────────────
  log('🔍 Scraping portals...');
  let scrapeResults;

  try {
    if (source === 'epms') {
      const epmsTenders = await scraper.scrapeEPMS();
      scrapeResults = { epms: epmsTenders, epads: [], errors: [] };
    } else if (source === 'epads') {
      const epadsTenders = await scraper.scrapeEPADS();
      scrapeResults = { epms: [], epads: epadsTenders, errors: [] };
    } else {
      scrapeResults = await scraper.scrapeAll();
    }
  } catch (err) {
    stats.errors.push(`Scrape failed: ${err.message}`);
    log(`❌ Scrape failed: ${err.message}`);
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  const allTenders = [...scrapeResults.epms, ...scrapeResults.epads];
  stats.tendersScraped = allTenders.length;
  log(`  Scraped: ${scrapeResults.epms.length} EPMS + ${scrapeResults.epads.length} EPADS = ${allTenders.length} total`);

  for (const e of (scrapeResults.errors || [])) {
    stats.errors.push(`Scrape ${e.source}: ${e.error}`);
  }

  // ─── Step 2: Classify ────────────────────────────────
  log('🧠 Classifying tenders...');
  let classified;
  try {
    classified = await classify.classifyBatch(allTenders);
  } catch (err) {
    log(`❌ Classification failed: ${err.message}, falling back to keyword-only`);
    // Fallback: keyword-only
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

  const relevant = classified.relevant;
  stats.relevantCount = relevant.length;
  stats.tenders = relevant;
  log(`  Results: ${relevant.length} IT-relevant, ${classified.excluded.length} excluded`);

  // ─── Step 3: Store ───────────────────────────────────
  log('💾 Storing in database...');
  const storeStats = db.upsertBatch(relevant);
  stats.newCount = storeStats.new;
  stats.updatedCount = storeStats.updated;

  log(`  New: ${storeStats.new}, Updated: ${storeStats.updated}, Unchanged: ${storeStats.unchanged}`);

  // Track deadline changes
  stats.updatedTenders = storeStats.deadlineChanges || [];

  // ─── Step 4: Save snapshots ──────────────────────────
  try {
    if (scrapeResults.epms.length > 0) {
      db.saveSnapshot('epms', `EPMS listing — ${scrapeResults.epms.length} tenders`);
    }
    if (scrapeResults.epads.length > 0) {
      db.saveSnapshot('epads', `EPADS listing — ${scrapeResults.epads.length} tenders`);
    }
  } catch (e) {
    log(`⚠️ Snapshot save error: ${e.message}`);
  }

  // ─── Step 5: Log run ─────────────────────────────────
  const durationMs = Date.now() - startTime;
  stats.durationMs = durationMs;
  stats.errors = stats.errors.length > 0 ? JSON.stringify(stats.errors) : null;

  db.logRun({
    startedAt: stats.startedAt,
    source,
    tendersScraped: stats.tendersScraped,
    relevantCount: stats.relevantCount,
    newCount: stats.newCount,
    updatedCount: stats.updatedCount,
    durationMs,
    errors: stats.errors,
  });

  log(`✅ Pipeline complete: ${relevant.length} relevant, ${durationMs}ms`);

  return stats;
}

module.exports = { runPipeline };
