#!/usr/bin/env node

/**
 * Test script for the classification module
 * Run: node scripts/test-classify.js
 *
 * Scrapes both portals, runs classification, shows results.
 */

const { scrapeAll } = require('../lib/scraper');
const { classifyBatch } = require('../lib/classify');

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   PITAS Classification Test          ║');
  console.log('╚══════════════════════════════════════╝');

  // Scrape
  console.log('\n📡 Scraping portals...');
  const scraped = await scrapeAll();
  const allTenders = [...scraped.epms, ...scraped.epads];

  if (allTenders.length === 0) {
    console.log('❌ No tenders scraped — cannot test classification');
    process.exit(1);
  }

  console.log(`\n📊 Total tenders to classify: ${allTenders.length}`);

  // Classify
  console.log('\n🔍 Running classification...');
  const results = await classifyBatch(allTenders);

  // Show relevant tenders
  console.log('\n✅ RELEVANT TENDERS (IT-related):');
  console.log('─'.repeat(60));
  results.relevant.forEach((t, i) => {
    const c = t.classification;
    console.log(`\n${i + 1}. [${t.source.toUpperCase()}] ${t.tenderId}`);
    console.log(`   Title:  ${t.title}`);
    console.log(`   Org:    ${(t.organization || '').substring(0, 50)}`);
    console.log(`   Close:  ${t.closingDate}`);
    console.log(`   Method: ${c.method} — ${c.reason}`);
  });

  // Show excluded sample
  console.log('\n\n❌ EXCLUDED TENDERS (sample of first 10):');
  console.log('─'.repeat(60));
  results.excluded.slice(0, 10).forEach((t, i) => {
    const c = t.classification;
    console.log(`\n${i + 1}. [${t.source.toUpperCase()}] ${t.tenderId}`);
    console.log(`   Title:  ${t.title.substring(0, 70)}`);
    console.log(`   Method: ${c.method} — ${c.reason}`);
  });

  // Stats
  console.log('\n\n📈 CLASSIFICATION STATS:');
  console.log('─'.repeat(60));
  console.log(`  Total tenders:     ${allTenders.length}`);
  console.log(`  Relevant (IT):     ${results.relevant.length}`);
  console.log(`  Excluded (non-IT): ${results.excluded.length}`);
  console.log(`  IT percentage:     ${((results.relevant.length / allTenders.length) * 100).toFixed(1)}%`);
  console.log(`\n  By method:`);
  console.log(`    Hard-include:    ${results.stats.include}`);
  console.log(`    Hard-exclude:    ${results.stats.exclude}`);
  console.log(`    AI classified:   ${results.stats.ai}`);
  console.log(`    AI fallback:     ${results.stats['ai-fallback'] || 0}`);
  console.log(`    AI errors:       ${results.stats['ai-error'] || 0}`);
}

main().catch(console.error);
