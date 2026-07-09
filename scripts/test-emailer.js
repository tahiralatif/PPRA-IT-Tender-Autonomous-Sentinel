/**
 * Emailer Module Tests
 * Tests template generation, filtering, and dry-run sending
 */
const emailer = require('../lib/emailer');
const db = require('../lib/db');

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

async function runTests() {
  console.log('╔════════════════════════════════════╗');
  console.log('║   PITAS Emailer Tests              ║');
  console.log('╚════════════════════════════════════╝\n');

  // ─── HTML Template ─────────────────────────────
  console.log('📧 HTML Template:');
  const html = emailer.buildDigestHtml({
    userName: 'Tara',
    newTenders: [
      { title: 'Procurement of Laptops', department: 'Ministry of IT', closingDate: 'Jul 24, 2026', url: 'https://example.com/tender/1', sector: 'ICT', classification: { reason: 'Matched Hardware' } },
      { title: 'Network Switches', department: 'NTC', closingDate: 'Jul 30, 2026', url: 'https://example.com/tender/2' },
    ],
    updatedTenders: [
      { tender: { title: 'Firewall Upgrade', url: 'https://example.com/tender/3' }, oldClosingDate: 'Jul 20', newClosingDate: 'Jul 25' },
    ],
    unsubscribeUrl: 'http://localhost:3000/unsubscribe/abc123',
    siteUrl: 'http://localhost:3000',
  });

  assert('Contains header', html.includes('PITAS Daily Tender Alert'));
  assert('Contains date', html.includes('2026'));
  assert('Contains greeting', html.includes('Hi Tara'));
  assert('Contains new tenders section', html.includes('NEW IT TENDERS'));
  assert('Contains 2 new tenders', html.includes('1. Procurement of Laptops') && html.includes('2. Network Switches'));
  assert('Contains updated tenders section', html.includes('UPDATED TENDERS'));
  assert('Contains deadline change', html.includes('Jul 20') && html.includes('Jul 25'));
  assert('Contains department', html.includes('Ministry of IT'));
  assert('Contains closing date', html.includes('Jul 24, 2026'));
  assert('Contains tender URL', html.includes('https://example.com/tender/1'));
  assert('Contains sector', html.includes('ICT'));
  assert('Contains classification reason', html.includes('Matched Hardware'));
  assert('Contains unsubscribe link', html.includes('unsubscribe/abc123'));
  assert('Contains CAN-SPAM footer', html.includes('registered at'));
  assert('Contains unsubscribe text in footer', html.includes('Unsubscribe'));
  assert('Valid HTML structure', html.includes('<!DOCTYPE html>') && html.includes('</html>'));

  // ─── Empty digest ──────────────────────────────
  console.log('\n📧 Empty Digest:');
  const emptyHtml = emailer.buildDigestHtml({
    userName: 'Tara',
    newTenders: [],
    updatedTenders: [],
    unsubscribeUrl: 'http://localhost:3000/unsubscribe/abc',
    siteUrl: 'http://localhost:3000',
  });

  assert('Shows no-tenders message', emptyHtml.includes('No new or updated IT tenders today'));
  assert('Still has unsubscribe', emptyHtml.includes('unsubscribe'));

  // ─── Plain text ────────────────────────────────
  console.log('\n📧 Plain Text:');
  const text = emailer.buildDigestText({
    userName: 'Tara',
    newTenders: [
      { title: 'Test Tender', department: 'Min IT', closingDate: 'Jul 24', url: 'https://example.com', classification: { reason: 'Matched Software' } },
    ],
    updatedTenders: [
      { tender: { title: 'Updated Tender', url: 'https://example.com/2' }, oldClosingDate: 'Jul 20', newClosingDate: 'Jul 25' },
    ],
    unsubscribeUrl: 'http://localhost:3000/unsubscribe/abc',
    siteUrl: 'http://localhost:3000',
  });

  assert('Contains header', text.includes('PITAS Daily Tender Alert'));
  assert('Contains greeting', text.includes('Hi Tara'));
  assert('Contains new tenders', text.includes('NEW IT TENDERS'));
  assert('Contains updated tenders', text.includes('UPDATED TENDERS'));
  assert('Contains tender title', text.includes('Test Tender'));
  assert('Contains deadline change', text.includes('Jul 20') && text.includes('Jul 25'));
  assert('Contains unsubscribe URL', text.includes('unsubscribe/abc'));
  assert('Contains site URL', text.includes('localhost:3000'));

  // ─── filterTenders ─────────────────────────────
  console.log('\n🔍 Filter Tenders:');
  const tenders = [
    { title: 'Software Procurement', department: 'Ministry of IT Punjab', description: '' },
    { title: 'Hardware Supply', department: 'Government of Sindh', description: '' },
    { title: 'Cloud Services', department: 'Federal IT Board', description: '' },
    { title: 'Road Construction', department: 'Ministry of Works', description: '' },
  ];

  const noFilter = emailer.filterTenders(tenders, {});
  assert('No filter → all tenders', noFilter.length === 4);

  const punjabFilter = emailer.filterTenders(tenders, { province: ['Punjab'] });
  assert('Punjab filter → 1 result', punjabFilter.length === 1 && punjabFilter[0].title === 'Software Procurement');

  const multiFilter = emailer.filterTenders(tenders, { province: ['Punjab', 'Sindh'] });
  assert('Multi-province filter → 2 results', multiFilter.length === 2);

  const categoryFilter = emailer.filterTenders(tenders, { category: ['Software'] });
  assert('Category filter → 1 result', categoryFilter.length === 1 && categoryFilter[0].title === 'Software Procurement');

  const descFilter = emailer.filterTenders([
    { title: 'General Procurement', department: 'Ministry', description: 'Includes networking equipment and switches' },
  ], { category: ['Networking'] });
  assert('Description matches category', descFilter.length === 1);

  // ─── Dry-run sending ──────────────────────────
  console.log('\n📮 Dry-Run Sending:');
  db.init();

  const user = db.registerUser('emailer-test@example.com', { province: ['Federal'] });
  db.verifyUser(user.verifyToken);

  const vResult = await emailer.sendVerification({ email: 'emailer-test@example.com', verify_token: user.verifyToken });
  assert('Verification dry-run returns sent=false', vResult.sent === false);

  const dResult = await emailer.sendDigest(
    { email: 'emailer-test@example.com', unsubscribe_token: user.unsubscribeToken },
    { newTenders: [{ title: 'Test', url: 'https://example.com' }], updatedTenders: [] }
  );
  assert('Digest dry-run returns sent=false', dResult.sent === false);

  const aResult = await emailer.sendAdminAlert('Test error');
  assert('Admin alert dry-run (no admin email)', aResult.sent === false);

  db.close();

  // ─── Summary ───────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(40)}`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('❌ Test error:', err.message);
  process.exit(1);
});
