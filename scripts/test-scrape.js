#!/usr/bin/env node

/**
 * Test script for the scraper module
 * Run: node scripts/test-scrape.js
 *
 * Tests both EPMS and EPADS scrapers individually and combined.
 */

const { scrapeEPMS, scrapeEPADS, scrapeAll } = require('../lib/scraper');

async function testEPMS() {
  console.log('\n🧪 Testing EPMS scraper...\n');
  try {
    const tenders = await scrapeEPMS();
    console.log(`✅ EPMS: ${tenders.length} tenders scraped`);

    if (tenders.length > 0) {
      const sample = tenders[0];
      console.log('\nSample tender:');
      console.log(`  ID:          ${sample.tenderId}`);
      console.log(`  Title:       ${sample.title}`);
      console.log(`  Organization:${sample.organization}`);
      console.log(`  Published:   ${sample.publishedDate}`);
      console.log(`  Closing:     ${sample.closingDate}`);
      console.log(`  Sector:      ${sample.sector}`);
      console.log(`  URL:         ${sample.url}`);
      console.log(`  Description: ${(sample.description || '').substring(0, 150)}...`);
    }

    return tenders;
  } catch (err) {
    console.error(`❌ EPMS failed: ${err.message}`);
    return [];
  }
}

async function testEPADS() {
  console.log('\n🧪 Testing EPADS scraper...\n');
  try {
    const tenders = await scrapeEPADS();
    console.log(`✅ EPADS: ${tenders.length} tenders scraped`);

    if (tenders.length > 0) {
      const sample = tenders[0];
      console.log('\nSample tender:');
      console.log(`  ID:          ${sample.tenderId}`);
      console.log(`  Title:       ${sample.title}`);
      console.log(`  Published:   ${sample.publishedDate}`);
      console.log(`  Closing:     ${sample.closingDate}`);
      console.log(`  Type:        ${sample.sector}`);
      console.log(`  URL:         ${sample.url}`);
    }

    return tenders;
  } catch (err) {
    console.error(`❌ EPADS failed: ${err.message}`);
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const target = args[0] || 'all';

  console.log('╔══════════════════════════════════════╗');
  console.log('║   PITAS Scraper Test                 ║');
  console.log('╚══════════════════════════════════════╝');

  let results;

  switch (target) {
    case 'epms':
      results = { epms: await testEPMS(), epads: [], errors: [] };
      break;
    case 'epads':
      results = { epms: [], epads: await testEPADS(), errors: [] };
      break;
    default:
      results = await scrapeAll();
      break;
  }

  // Summary
  console.log('\n📊 Summary:');
  console.log(`  EPMS tenders:  ${results.epms.length}`);
  console.log(`  EPADS tenders: ${results.epads.length}`);
  console.log(`  Total:         ${results.epms.length + results.epads.length}`);
  console.log(`  Errors:        ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    for (const e of results.errors) {
      console.log(`  ${e.source}: ${e.error}`);
    }
  }
}

main().catch(console.error);
