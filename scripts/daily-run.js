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
const emailer = require('../lib/emailer');
const { runPipeline } = require('../lib/pipeline');

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

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  log('═══════════════════════════════════════════════════');
  log(`PITAS Daily Run — ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  log(`Source: ${source}`);
  log('═══════════════════════════════════════════════════');

  try {
    db.init();

    const stats = await runPipeline({ source, onProgress: log });

    // ─── Email digests ───────────────────────────────
    if (dryRun) {
      log('\n📧 DRY RUN — skipping email sending');
      log(`  Would send to ${db.getVerifiedUsers().length} users`);
      log(`  New tenders: ${stats.newCount}, Updated: ${stats.updatedCount}`);
    } else {
      log('\n📧 Sending email digests...');
      const emailResult = await emailer.sendDailyDigests({
        newTenders: stats.tenders,
        updatedTenders: stats.updatedTenders,
      });
      stats.emailsSent = emailResult.sent;
      log(`  Sent: ${emailResult.sent}, Skipped: ${emailResult.skipped}, Errors: ${emailResult.errors}`);
    }

    // ─── Summary ─────────────────────────────────────
    log('\n═══════════════════════════════════════════════════');
    log('✅ Daily run complete!');
    log(`  Duration: ${(stats.durationMs / 1000).toFixed(1)}s`);
    log(`  Scraped: ${stats.tendersScraped}`);
    log(`  IT-relevant: ${stats.relevantCount}`);
    log(`  New: ${stats.newCount}, Updated: ${stats.updatedCount}`);
    log(`  Emails sent: ${stats.emailsSent || 0}`);
    if (stats.errors) log(`  Errors: ${stats.errors}`);
    log('═══════════════════════════════════════════════════\n');
  } catch (err) {
    logError('Pipeline failed', err);
    try {
      await emailer.sendAdminAlert(`Pipeline failed: ${err.message}\n\n${err.stack || ''}`);
    } catch (e) {
      logError('Failed to send admin alert', e);
    }
    process.exitCode = 1;
  } finally {
    logStream.end();
    try { db.close(); } catch (e) {}
  }
}

main();
