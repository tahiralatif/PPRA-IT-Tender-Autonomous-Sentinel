#!/usr/bin/env node
/**
 * Classification Audit Script
 *
 * Pulls recent tenders from the database and shows their classification
 * details so humans can verify accuracy (false positives/negatives).
 *
 * Usage: node scripts/audit-classification.js [--limit N] [--source epms|epads]
 */

const path = require('path');
const db = require('../lib/db');

// Parse CLI args
const args = process.argv.slice(2);
let limit = 50;
let sourceFilter = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]) || 50;
  if (args[i] === '--source' && args[i + 1]) sourceFilter = args[i + 1];
}

db.init();
const database = db.getDb();

let query = 'SELECT * FROM tenders ORDER BY discovered_at DESC';
const params = [];

if (sourceFilter) {
  query = 'SELECT * FROM tenders WHERE source = ? ORDER BY discovered_at DESC';
  params.push(sourceFilter);
}

query += ` LIMIT ${limit}`;

const tenders = database.prepare(query).all(...params);

// Group by classification_method
const groups = {};
for (const t of tenders) {
  const method = t.classification_method || 'unknown';
  if (!groups[method]) groups[method] = [];
  groups[method].push(t);
}

// Print results
console.log(`\n${'='.repeat(80)}`);
console.log(`  PITAS Classification Audit — ${tenders.length} most recent tenders`);
console.log(`${'='.repeat(80)}\n`);

for (const [method, items] of Object.entries(groups)) {
  console.log(`\n━━━ ${method.toUpperCase()} (${items.length} tenders) ━━━\n`);
  for (const t of items) {
    console.log(`  Title:        ${t.title}`);
    console.log(`  Source:       ${t.source}`);
    console.log(`  Department:   ${t.department || 'N/A'}`);
    console.log(`  Deadline:     ${t.closing_date || 'N/A'}`);
    console.log(`  Reason:       ${t.classification_reason || 'N/A'}`);
    console.log(`  Discovered:   ${t.discovered_at}`);
    console.log(`  ─────────────────────────────────────────────────`);
  }
}

// Summary
console.log(`\n${'='.repeat(80)}`);
console.log('  SUMMARY');
console.log(`${'='.repeat(80)}`);
for (const [method, items] of Object.entries(groups)) {
  console.log(`  ${method}: ${items.length} tenders`);
}
console.log(`  Total: ${tenders.length} tenders`);
console.log(`${'='.repeat(80)}\n`);

db.close();
