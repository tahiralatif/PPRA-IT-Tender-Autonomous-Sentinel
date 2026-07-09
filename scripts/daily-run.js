#!/usr/bin/env node
/**
 * PITAS Daily Run — Main orchestration script
 *
 * Pipeline: scrape → classify → dedupe/store → match users → email
 *
 * Usage:
 *   node scripts/daily-run.js                    # Full run
 *   node scripts/daily-run.js --dry-run          # Skip email sending
 *   node scripts/daily-run.js --source=epms      # Scrape only EPMS
 *   node scripts/daily-run.js --source=epads     # Scrape only EPADS
 *   node scripts/daily-run.js --dry-run --source=epms
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const scraper = require('../lib/scraper');
const classify = require('../lib/classify');
const emailer = require('../lib/emailer');
const config = require('../lib/config');

// ─── Parse CLI args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceArg = args.find(a => a.startsWith('--source='));
const source = sourceArg ? sourceArg.split('=')[1] : 'all';

// ─── Logging setup ──────────────────────────────────────────────
const logDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'daily-run.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

function logError(msg, err) {
  const line = `[${new Date().toISOString()}] ❌ ${msg}: ${err?.message || err}`;
  console.error(line);
  logStream.write(line + '\n');
  if (err?.stack) logStream.write(err.stack + '\n');
}

// ─── Main Pipeline ──────────────────────────────────────────────
async function run() {
  const startTime = Date.now();
  const runStats = {
    startedAt: new Date().toISOString(),
    source,
    tendersScraped: 0,
    relevantCount: 0,
    newCount: 0,
    updatedCount: 0,
    emailsSent: 0,
    errors: [],
  };

  log('═══════════════════════════════════════════════════');
  log(`PITAS Daily Run — ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  log(`Source: ${source}`);
  log('═══════════════════════════════════════════════════');

  try {
    // ─── Step 1: Initialize ───────────────────────────────
    log('\n📋 Step 1: Initializing...');
    db.init();
    log('  Database initialized');

    // ─── Step 2: Scrape ───────────────────────────────────
    log('\n🔍 Step 2: Scraping portals...');
    let scrapeResults;

    if (source === 'epms') {
      const epmsTenders = await scraper.scrapeEPMS();
      scrapeResults = { epms: epmsTenders, epads: [], errors: [] };
    } else if (source === 'epads') {
      const epadsTenders = await scraper.scrapeEPADS();
      scrapeResults = { epms: [], epads: epadsTenders, errors: [] };
    } else {
      scrapeResults = await scraper.scrapeAll();
    }

    const allTenders = [...scrapeResults.epms, ...scrapeResults.epads];
    runStats.tendersScraped = allTenders.length;

    log(`  Scraped: ${scrapeResults.epms.length} EPMS + ${scrapeResults.epads.length} EPADS = ${allTenders.length} total`);

    if (scrapeResults.errors.length > 0) {
      for (const e of scrapeResults.errors) {
        runStats.errors.push(`Scrape ${e.source}: ${e.error}`);
        logError(`Scrape ${e.source}`, e.error);
      }
    }

    if (allTenders.length === 0) {
      const msg = 'Scraper returned 0 tenders — site structure may have changed or be blocked';
      runStats.errors.push(msg);
      logError(msg);
      await sendAdminAlert(msg);
    }

    // ─── Step 3: Classify ────────────────────────────────
    log('\n🧠 Step 3: Classifying tenders...');
    const classified = await classify.classifyBatch(allTenders);

    const relevant = classified.relevant;
    runStats.relevantCount = relevant.length;

    log(`  Results: ${relevant.length} IT-relevant, ${classified.excluded.length} excluded`);
    log(`  Stats: ${JSON.stringify(classified.stats)}`);

    // ─── Step 4: Store (dedupe + update detection) ────────
    log('\n💾 Step 4: Storing in database...');
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    const updatedTenders = [];

    for (const tender of relevant) {
      const result = db.upsertTender(tender);

      if (result.isNew) {
        newCount++;
      } else if (result.isUpdated) {
        updatedCount++;
        if (result.deadlineChanged) {
          updatedTenders.push({
            tender,
            oldClosingDate: result.oldClosingDate,
            newClosingDate: result.newClosingDate,
            direction: result.deadlineDirection,
          });
        }
      } else {
        unchangedCount++;
      }
    }

    runStats.newCount = newCount;
    runStats.updatedCount = updatedCount;

    log(`  New: ${newCount}, Updated: ${updatedCount}, Unchanged: ${unchangedCount}`);
    if (updatedTenders.length > 0) {
      log(`  Deadline changes: ${updatedTenders.length}`);
      for (const u of updatedTenders) {
        log(`    ${u.tender.title}: ${u.oldClosingDate} → ${u.newClosingDate} (${u.direction})`);
      }
    }

    // ─── Step 5: Save snapshots to DB ────────────────────
    log('\n📸 Step 5: Saving snapshots...');
    try {
      if (scrapeResults.epms.length > 0) {
        db.saveSnapshot('epms', `EPMS listing — ${scrapeResults.epms.length} tenders`);
      }
      if (scrapeResults.epads.length > 0) {
        db.saveSnapshot('epads', `EPADS listing — ${scrapeResults.epads.length} tenders`);
      }
    } catch (e) {
      logError('Snapshot save', e);
    }

    // ─── Step 6: Email digests ───────────────────────────
    log('\n📧 Step 6: Sending email digests...');
    if (dryRun) {
      log('  DRY RUN — skipping email sending');
      log(`  Would send to ${db.getVerifiedUsers().length} users`);
      log(`  New tenders: ${newCount}, Updated: ${updatedCount}`);
    } else {
      const emailResult = await emailer.sendDailyDigests({
        newTenders: relevant,
        updatedTenders,
      });
      runStats.emailsSent = emailResult.sent;
      log(`  Sent: ${emailResult.sent}, Skipped: ${emailResult.skipped}, Errors: ${emailResult.errors}`);
    }

    // ─── Step 7: Log run ─────────────────────────────────
    log('\n📊 Step 7: Logging run...');
    const durationMs = Date.now() - startTime;
    runStats.durationMs = durationMs;
    runStats.errors = runStats.errors.length > 0 ? JSON.stringify(runStats.errors) : null;

    db.logRun(runStats);
    log('  Run logged to database');

    // ─── Summary ─────────────────────────────────────────
    log('\n═══════════════════════════════════════════════════');
    log('✅ Pipeline complete!');
    log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);
    log(`  Scraped: ${runStats.tendersScraped}`);
    log(`  IT-relevant: ${runStats.relevantCount}`);
    log(`  New: ${runStats.newCount}, Updated: ${runStats.updatedCount}`);
    log(`  Emails sent: ${runStats.emailsSent}`);
    if (runStats.errors) log(`  Errors: ${runStats.errors}`);
    log('═══════════════════════════════════════════════════\n');

  } catch (err) {
    logError('Pipeline failed', err);
    runStats.errors = JSON.stringify([err.message]);
    runStats.durationMs = Date.now() - startTime;

    try {
      db.logRun(runStats);
    } catch (e) {
      // DB might not be initialized
    }

    await sendAdminAlert(`Pipeline failed: ${err.message}\n\n${err.stack || ''}`);
    process.exitCode = 1;
  } finally {
    logStream.end();
    try { db.close(); } catch (e) {}
  }
}

async function sendAdminAlert(message) {
  try {
    await emailer.sendAdminAlert(message);
  } catch (e) {
    logError('Failed to send admin alert', e);
  }
}

run();
