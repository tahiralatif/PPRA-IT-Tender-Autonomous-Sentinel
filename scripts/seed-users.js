#!/usr/bin/env node
/**
 * PITAS Seed Users — One-time script to register initial contacts
 *
 * Usage:
 *   node scripts/seed-users.js                     # Interactive
 *   node scripts/seed-users.js --email=user@co.com # Single user
 *   node scripts/seed-users.js --file=users.json   # Bulk from JSON file
 *
 * JSON file format:
 *   [
 *     { "email": "user@company.com", "filters": { "province": ["Punjab"] } },
 *     { "email": "admin@gov.pk", "filters": {} }
 *   ]
 */

require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const args = process.argv.slice(2);

async function addUser(email, filters = {}) {
  // Check if already exists
  const existing = db.getUserByEmail(email);
  if (existing) {
    if (existing.verified) {
      console.log(`  ⚠️  ${email} — already registered and verified`);
      return null;
    }
    // Unverified — re-register
    db.getDb().prepare('DELETE FROM users WHERE email = ?').run(email);
    console.log(`  🔄 ${email} — re-registered (was unverified)`);
  }

  const result = db.registerUser(email, filters);
  // Auto-verify seed users (they're manually vetted)
  db.verifyUser(result.verifyToken);

  console.log(`  ✅ ${email} — registered & auto-verified`);
  return result;
}

async function seedFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(users)) {
    console.error('❌ File must contain a JSON array');
    process.exit(1);
  }

  console.log(`\n📋 Seeding ${users.length} users from ${filePath}...\n`);

  let added = 0;
  for (const user of users) {
    if (!user.email) {
      console.log(`  ⚠️  Skipping entry without email: ${JSON.stringify(user)}`);
      continue;
    }
    const result = await addUser(user.email, user.filters || {});
    if (result) added++;
  }

  console.log(`\n✅ Done: ${added} users seeded, ${users.length - added} skipped/already exist`);
}

async function seedInteractive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('\n📋 PITAS Seed User Registration');
  console.log('   Enter emails to register. Type "done" when finished.\n');

  const users = [];

  while (true) {
    const email = (await ask('  Email: ')).trim();
    if (email.toLowerCase() === 'done' || email === '') break;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('  ❌ Invalid email, try again');
      continue;
    }

    const province = (await ask('  Province (Punjab/Sindh/KPK/Balochistan/Federal) or Enter for all: ')).trim();
    const category = (await ask('  Category (Software/Hardware/Networking/Cloud/Security) or Enter for all: ')).trim();

    const filters = {};
    if (province) filters.province = [province];
    if (category) filters.category = [category];

    users.push({ email, filters });
  }

  rl.close();

  if (users.length === 0) {
    console.log('\n  No users to add.');
    return;
  }

  console.log(`\n📋 Adding ${users.length} users...\n`);
  let added = 0;
  for (const user of users) {
    const result = await addUser(user.email, user.filters);
    if (result) added++;
  }

  console.log(`\n✅ Done: ${added} users seeded`);
}

async function seedSingle(email) {
  console.log(`\n📋 Seeding single user: ${email}\n`);
  await addUser(email);
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  db.init();

  const fileArg = args.find(a => a.startsWith('--file='));
  const emailArg = args.find(a => a.startsWith('--email='));

  if (fileArg) {
    await seedFromFile(fileArg.split('=')[1]);
  } else if (emailArg) {
    await seedSingle(emailArg.split('=')[1]);
  } else {
    await seedInteractive();
  }

  // Show current users
  const users = db.getVerifiedUsers();
  console.log(`\n📊 Current verified users: ${users.length}`);
  for (const u of users) {
    const filters = JSON.parse(u.filters || '{}');
    const filterStr = Object.keys(filters).length
      ? ` (${Object.entries(filters).map(([k, v]) => `${k}:${v.join(',')}`).join(', ')})`
      : ' (no filters)';
    console.log(`   ${u.email}${filterStr}`);
  }

  db.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
