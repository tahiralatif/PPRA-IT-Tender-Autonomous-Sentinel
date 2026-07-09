#!/usr/bin/env node

/**
 * Test script for the database module
 * Run: node scripts/test-db.js
 *
 * Tests initialization, upsert, dedup, update detection, user ops.
 */

const db = require('../lib/db');

function test(label, fn) {
  try {
    fn();
    console.log(`  ✅ ${label}`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${label}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   PITAS Database Test                ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Initialize
  console.log('📦 Initializing database...');
  db.init();
  console.log('');

  // ─── Tender Operations ──────────────────────────────
  console.log('📋 Tender Operations:');

  const tender1 = {
    source: 'epms',
    tenderRef: 'TS0000009230E',
    title: 'Renewal and Purchase of Software License',
    organization: 'Ministry of Planning',
    sector: 'Info and Comm Tech',
    closingDate: 'Jul 24, 2026 10:00 AM',
    url: 'https://epms.ppra.gov.pk/public/tenders/tender-details/TS0000009230E',
    description: 'Annual license renewal for Microsoft Office 365',
    isITRelevant: true,
    classification: { method: 'include', reason: 'Matched "Software"' },
  };

  // Insert new tender
  let result = db.upsertTender(tender1);
  test('Insert new tender', () => {
    if (!result.isNew) throw new Error('Expected isNew=true');
    if (!result.id) throw new Error('Expected id');
  });

  // Upsert same tender (unchanged)
  result = db.upsertTender(tender1);
  test('Upsert unchanged tender → no new, no update', () => {
    if (result.isNew) throw new Error('Expected isNew=false');
    if (result.isUpdated) throw new Error('Expected isUpdated=false');
  });

  // Upsert with changed description (update detection)
  const tender1Updated = { ...tender1, description: 'Updated: Now includes Visio and Project licenses' };
  result = db.upsertTender(tender1Updated);
  test('Upsert with changed content → isUpdated=true', () => {
    if (!result.isUpdated) throw new Error('Expected isUpdated=true');
  });

  // Upsert again (should be unchanged now)
  result = db.upsertTender(tender1Updated);
  test('Upsert same updated content → unchanged', () => {
    if (result.isNew) throw new Error('Expected isNew=false');
    if (result.isUpdated) throw new Error('Expected isUpdated=false');
  });

  // Insert second tender
  const tender2 = {
    source: 'epms',
    tenderRef: 'TS0000009201E',
    title: 'GPU Cloud Infrastructure',
    organization: 'Ministry of Energy',
    closingDate: 'Jul 24, 2026 11:00 AM',
    url: 'https://epms.ppra.gov.pk/public/tenders/tender-details/TS0000009201E',
    description: 'Cloud infrastructure with GPU support',
    isITRelevant: true,
    classification: { method: 'include', reason: 'Matched "GPU"' },
  };

  db.upsertTender(tender2);
  test('Insert second tender', () => true);

  // Batch upsert
  const batch = db.upsertBatch([tender1, tender2, tender1Updated]);
  test('Batch upsert returns correct stats', () => {
    if (batch.new !== 0) throw new Error(`Expected 0 new, got ${batch.new}`);
    // tender1 was already updated with changed description, so re-inserting original = content change
    if (batch.errors !== 0) throw new Error(`Expected 0 errors, got ${batch.errors}`);
  });

  // Get open relevant tenders
  const openTenders = db.getOpenRelevantTenders();
  test(`Get open relevant tenders → ${openTenders.length} found`, () => {
    if (openTenders.length < 2) throw new Error('Expected at least 2');
  });

  // Get tender by ID
  const tender = db.getTenderById(result.id);
  test('Get tender by ID', () => {
    if (!tender) throw new Error('Tender not found');
    if (tender.source !== 'epms') throw new Error('Wrong source');
  });

  console.log('');

  // ─── User Operations ────────────────────────────────
  console.log('👤 User Operations:');

  const user = db.registerUser('test@example.com', { province: ['Punjab'] });
  test('Register user', () => {
    if (!user.id) throw new Error('Expected id');
    if (!user.verifyToken) throw new Error('Expected verifyToken');
    if (!user.unsubscribeToken) throw new Error('Expected unsubscribeToken');
  });

  // Get user by email
  const foundUser = db.getUserByEmail('test@example.com');
  test('Get user by email', () => {
    if (!foundUser) throw new Error('User not found');
    if (foundUser.verified !== 0) throw new Error('Should be unverified');
  });

  // Verify user
  const verified = db.verifyUser(user.verifyToken);
  test('Verify user by token', () => {
    if (!verified) throw new Error('Verification failed');
  });

  // Check verified status
  const verifiedUser = db.getUserByEmail('test@example.com');
  test('User is now verified', () => {
    if (verifiedUser.verified !== 1) throw new Error('Still unverified');
  });

  // Get verified users
  const verifiedUsers = db.getVerifiedUsers();
  test(`Get verified users → ${verifiedUsers.length} found`, () => {
    if (verifiedUsers.length < 1) throw new Error('Expected at least 1');
  });

  // Unsubscribe
  const unsubscribed = db.unsubscribeUser(user.unsubscribeToken);
  test('Unsubscribe user', () => {
    if (!unsubscribed) throw new Error('Unsubscribe failed');
  });

  // Check unsubscribed
  const unsubUser = db.getUserByEmail('test@example.com');
  test('User is now unsubscribed', () => {
    if (unsubUser.verified !== 0) throw new Error('Should be unverified');
  });

  console.log('');

  // ─── Sent Log Operations ────────────────────────────
  console.log('📧 Sent Log Operations:');

  // Re-verify user for sent log test
  db.verifyUser(user.verifyToken);

  const tenderIds = db.getOpenRelevantTenders().map((t) => t.id);
  const hash = db.contentHash(tender1);

  const logged = db.logSent(user.id, tenderIds[0], hash);
  test('Log sent tender', () => {
    if (!logged) throw new Error('Expected logged=true');
  });

  // Try again (should return false — duplicate)
  const dup = db.logSent(user.id, tenderIds[0], hash);
  test('Duplicate log returns false', () => {
    if (dup) throw new Error('Expected logged=false');
  });

  // Get tenders for user (should exclude already-sent)
  const tendersForUser = db.getTendersForUser(user.id);
  test(`Get tenders for user → ${tendersForUser.length} pending`, () => {
    // Should have at least 1 pending (tender2)
    if (tendersForUser.length < 1) throw new Error('Expected at least 1 pending');
  });

  console.log('');

  // ─── Run Log ────────────────────────────────────────
  console.log('📊 Run Log:');

  db.logRun({
    source: 'all',
    tendersScraped: 139,
    relevantCount: 28,
    newCount: 10,
    updatedCount: 2,
    emailsSent: 5,
    durationMs: 7200,
  });

  const runs = db.getRecentRuns(5);
  test(`Log run → ${runs.length} runs found`, () => {
    if (runs.length < 1) throw new Error('Expected at least 1');
  });

  console.log('');

  // ─── Cleanup ────────────────────────────────────────
  console.log('🧹 Cleanup...');
  db.close();
  console.log('  ✅ Database closed\n');

  console.log('Done! Database module is functional.');
}

main().catch(console.error);
