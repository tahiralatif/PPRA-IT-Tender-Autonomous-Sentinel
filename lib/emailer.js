const { Resend } = require('resend');
const config = require('./config');
const db = require('./db');

let resendClient = null;

/**
 * Initialize Resend client
 */
function initResend() {
  const apiKey = config.email.apiKey;
  if (!apiKey) {
    console.warn('[emailer] No RESEND_API_KEY set — emails will not be sent');
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// ─── Email Template ─────────────────────────────────────────────

/**
 * Generate HTML email body for daily digest
 * @param {Object} opts
 * @param {string} opts.userName - recipient name (or "there")
 * @param {Array}  opts.newTenders - array of tender objects (new since last send)
 * @param {Array}  opts.updatedTenders - array of { tender, oldClosingDate, newClosingDate }
 * @param {string} opts.unsubscribeUrl - one-click unsubscribe link
 * @param {string} opts.siteUrl - site URL
 * @returns {string} HTML email body
 */
function buildDigestHtml({ userName, newTenders, updatedTenders, unsubscribeUrl, siteUrl }) {
  const date = new Date().toLocaleDateString('en-PK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let newSection = '';
  if (newTenders.length > 0) {
    newSection = `
      <div style="margin-bottom:24px">
        <h2 style="color:#1e40af;font-size:16px;margin-bottom:12px">🆕 NEW IT TENDERS (${newTenders.length})</h2>
        ${newTenders.map((t, i) => `
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px">
            <div style="font-weight:600;color:#0f172a;font-size:15px;margin-bottom:8px">${i + 1}. ${escapeHtml(t.title)}</div>
            <table style="font-size:13px;color:#475569;border-collapse:collapse">
              <tr><td style="padding:2px 8px 2px 0;white-space:nowrap">📋</td><td>${escapeHtml(t.department || t.organization || 'N/A')}</td></tr>
              <tr><td style="padding:2px 8px 2px 0;white-space:nowrap">📅</td><td>${escapeHtml(t.closingDate || 'Not specified')}</td></tr>
              ${t.sector ? `<tr><td style="padding:2px 8px 2px 0;white-space:nowrap">🏷️</td><td>${escapeHtml(t.sector)}</td></tr>` : ''}
              ${t.classification?.reason ? `<tr><td style="padding:2px 8px 2px 0;white-space:nowrap">💡</td><td>${escapeHtml(t.classification.reason)}</td></tr>` : ''}
            </table>
            <a href="${escapeHtml(t.url)}" style="display:inline-block;margin-top:8px;color:#2563eb;font-size:13px;text-decoration:none">View Tender →</a>
          </div>
        `).join('')}
      </div>
    `;
  }

  let updatedSection = '';
  if (updatedTenders.length > 0) {
    updatedSection = `
      <div style="margin-bottom:24px">
        <h2 style="color:#b45309;font-size:16px;margin-bottom:12px">⚠️ UPDATED TENDERS (${updatedTenders.length})</h2>
        ${updatedTenders.map(({ tender, oldClosingDate, newClosingDate }, i) => `
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:12px">
            <div style="font-weight:600;color:#0f172a;font-size:15px;margin-bottom:8px">${i + 1}. ${escapeHtml(tender.title)}</div>
            <div style="font-size:13px;color:#92400e">
              ${oldClosingDate && newClosingDate ? `📅 Deadline changed: <s>${escapeHtml(oldClosingDate)}</s> → <strong>${escapeHtml(newClosingDate)}</strong>` : '📋 Tender details updated'}
            </div>
            <a href="${escapeHtml(tender.url)}" style="display:inline-block;margin-top:8px;color:#2563eb;font-size:13px;text-decoration:none">View Tender →</a>
          </div>
        `).join('')}
      </div>
    `;
  }

  const total = newTenders.length + updatedTenders.length;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;padding:24px;margin:0">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:24px 32px;color:white">
      <div style="font-size:24px;margin-bottom:4px">🇵🇰</div>
      <div style="font-size:18px;font-weight:700">PITAS Daily Tender Alert</div>
      <div style="font-size:13px;opacity:0.85;margin-top:4px">${date}</div>
    </div>

    <!-- Content -->
    <div style="padding:24px 32px">
      <p style="font-size:15px;color:#334155;margin-bottom:20px">
        Hi ${escapeHtml(userName || 'there')},
      </p>
      <p style="font-size:15px;color:#334155;margin-bottom:24px">
        Here are today's IT-relevant government tenders from Pakistan's PPRA portals.
        <strong>${total} tender${total !== 1 ? 's' : ''}</strong> need your attention.
      </p>

      ${newSection}
      ${updatedSection}

      ${total === 0 ? `
        <div style="text-align:center;padding:32px;color:#94a3b8">
          <div style="font-size:36px;margin-bottom:8px">📭</div>
          <p>No new or updated IT tenders today. We'll check again tomorrow.</p>
        </div>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0">
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0 0 8px 0">
        You're receiving this because you registered at <a href="${escapeHtml(siteUrl)}" style="color:#6366f1">${escapeHtml(siteUrl)}</a>.
      </p>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6366f1">Unsubscribe</a> · 
        PITAS — PPRA IT-Tender Autonomous Sentinel
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate plain-text version of digest
 */
function buildDigestText({ userName, newTenders, updatedTenders, unsubscribeUrl, siteUrl }) {
  const date = new Date().toLocaleDateString('en-PK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let text = `PITAS Daily Tender Alert — ${date}\n\n`;
  text += `Hi ${userName || 'there'},\n\n`;
  text += `Here are today's IT-relevant government tenders.\n\n`;

  if (newTenders.length > 0) {
    text += `━━━ NEW IT TENDERS (${newTenders.length}) ━━━\n\n`;
    newTenders.forEach((t, i) => {
      text += `${i + 1}. ${t.title}\n`;
      text += `   Department: ${t.department || t.organization || 'N/A'}\n`;
      text += `   Deadline: ${t.closingDate || 'Not specified'}\n`;
      text += `   URL: ${t.url}\n`;
      if (t.classification?.reason) text += `   ${t.classification.reason}\n`;
      text += '\n';
    });
  }

  if (updatedTenders.length > 0) {
    text += `━━━ UPDATED TENDERS (${updatedTenders.length}) ━━━\n\n`;
    updatedTenders.forEach(({ tender, oldClosingDate, newClosingDate }, i) => {
      text += `${i + 1}. ${tender.title}\n`;
      if (oldClosingDate && newClosingDate) {
        text += `   Deadline changed: ${oldClosingDate} → ${newClosingDate}\n`;
      } else {
        text += `   Tender details updated\n`;
      }
      text += `   URL: ${tender.url}\n\n`;
    });
  }

  if (newTenders.length === 0 && updatedTenders.length === 0) {
    text += `No new or updated IT tenders today.\n`;
  }

  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Registered at: ${siteUrl}\n`;
  text += `Unsubscribe: ${unsubscribeUrl}\n`;

  return text;
}

// ─── Helpers ────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Send Functions ─────────────────────────────────────────────

/**
 * Send daily digest to a single user
 * @param {Object} user - user record from DB
 * @param {Object} opts
 * @param {Array}  opts.newTenders - new tenders for this user
 * @param {Array}  opts.updatedTenders - updated tenders [{tender, oldClosingDate, newClosingDate}]
 * @returns {Object} { sent: boolean, error?: string }
 */
async function sendDigest(user, { newTenders, updatedTenders }) {
  const client = initResend();
  const siteUrl = config.siteUrl;
  const unsubscribeUrl = `${siteUrl}/unsubscribe/${user.unsubscribe_token}`;

  const html = buildDigestHtml({
    userName: user.email.split('@')[0],
    newTenders,
    updatedTenders,
    unsubscribeUrl,
    siteUrl,
  });

  const text = buildDigestText({
    userName: user.email.split('@')[0],
    newTenders,
    updatedTenders,
    unsubscribeUrl,
    siteUrl,
  });

  const total = newTenders.length + updatedTenders.length;
  const subject = `🇵🇰 IT Tender Alert — ${new Date().toLocaleDateString('en-PK')} — ${total} tender${total !== 1 ? 's' : ''}`;

  // If no API key, log and skip
  if (!client) {
    console.log(`[emailer] DRY RUN — would send to ${user.email}: ${subject}`);
    return { sent: false, error: 'No API key configured' };
  }

  try {
    const { data, error } = await client.emails.send({
      from: `${config.email.fromName} <${config.email.from}>`,
      to: [user.email],
      subject,
      html,
      text,
    });

    if (error) {
      console.error(`[emailer] Failed to send to ${user.email}:`, error.message);
      return { sent: false, error: error.message };
    }

    console.log(`[emailer] Sent to ${user.email}: ${subject}`);
    return { sent: true, messageId: data?.id };
  } catch (err) {
    console.error(`[emailer] Error sending to ${user.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send verification email to a newly registered user
 */
async function sendVerification(user) {
  const client = initResend();
  const siteUrl = config.siteUrl;
  const verifyUrl = `${siteUrl}/api/verify/${user.verify_token}`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f1f5f9;padding:24px;margin:0">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center">
    <div style="font-size:36px;margin-bottom:12px">📧</div>
    <h2 style="color:#0f172a;margin-bottom:12px">Verify Your Email</h2>
    <p style="color:#475569;font-size:15px;margin-bottom:24px">
      Click the button below to activate your PITAS tender alerts subscription.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
      Verify Email
    </a>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">
      If you didn't register, you can safely ignore this email.
    </p>
  </div>
</body></html>`;

  if (!client) {
    console.log(`[emailer] DRY RUN — would send verification to ${user.email}`);
    return { sent: false };
  }

  try {
    const { error } = await client.emails.send({
      from: `${config.email.fromName} <${config.email.from}>`,
      to: [user.email],
      subject: '📧 Verify your PITAS subscription',
      html,
    });

    if (error) {
      console.error(`[emailer] Verification failed for ${user.email}:`, error.message);
      return { sent: false, error: error.message };
    }

    console.log(`[emailer] Verification sent to ${user.email}`);
    return { sent: true };
  } catch (err) {
    console.error(`[emailer] Verification error for ${user.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send unsubscribe confirmation email
 */
async function sendUnsubConfirmation(user) {
  const client = initResend();
  const siteUrl = config.siteUrl;
  const unsubUrl = `${siteUrl}/unsubscribe/${user.unsubscribe_token}`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f1f5f9;padding:24px;margin:0">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center">
    <div style="font-size:36px;margin-bottom:12px">📭</div>
    <h2 style="color:#0f172a;margin-bottom:12px">Unsubscribe Confirmation</h2>
    <p style="color:#475569;font-size:15px;margin-bottom:24px">
      Click the button below to stop receiving tender alerts.
    </p>
    <a href="${unsubUrl}" style="display:inline-block;background:#ef4444;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
      Unsubscribe
    </a>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">
      Changed your mind? Just ignore this email.
    </p>
  </div>
</body></html>`;

  if (!client) {
    console.log(`[emailer] DRY RUN — would send unsub confirmation to ${user.email}`);
    return { sent: false };
  }

  try {
    const { error } = await client.emails.send({
      from: `${config.email.fromName} <${config.email.from}>`,
      to: [user.email],
      subject: '📭 Unsubscribe from PITAS Tender Alerts',
      html,
    });

    if (error) {
      console.error(`[emailer] Unsub confirmation failed for ${user.email}:`, error.message);
      return { sent: false, error: error.message };
    }

    console.log(`[emailer] Unsub confirmation sent to ${user.email}`);
    return { sent: true };
  } catch (err) {
    console.error(`[emailer] Unsub confirmation error for ${user.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send admin alert when pipeline fails
 */
async function sendAdminAlert(errorMsg) {
  const client = initResend();
  const adminEmail = config.admin?.email || config.email.adminEmail;

  if (!adminEmail) {
    console.warn('[emailer] No ADMIN_EMAIL configured — cannot send alert');
    return { sent: false };
  }

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f1f5f9;padding:24px;margin:0">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border-left:4px solid #ef4444">
    <h2 style="color:#dc2626;margin-bottom:12px">⚠️ Pipeline Alert</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:16px">
      The PITAS daily pipeline encountered an error:
    </p>
    <pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;font-size:13px;color:#991b1b;overflow-x:auto">${escapeHtml(errorMsg)}</pre>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">
      ${new Date().toISOString()}
    </p>
  </div>
</body></html>`;

  if (!client) {
    console.log(`[emailer] DRY RUN — would send admin alert: ${errorMsg.substring(0, 100)}`);
    return { sent: false };
  }

  try {
    const { error } = await client.emails.send({
      from: `${config.email.fromName} <${config.email.from}>`,
      to: [adminEmail],
      subject: '⚠️ PITAS Pipeline Alert',
      html,
    });

    if (error) {
      console.error(`[emailer] Admin alert failed:`, error.message);
      return { sent: false, error: error.message };
    }

    console.log(`[emailer] Admin alert sent to ${adminEmail}`);
    return { sent: true };
  } catch (err) {
    console.error(`[emailer] Admin alert error:`, err.message);
    return { sent: false, error: err.message };
  }
}

// ─── Batch Digest ───────────────────────────────────────────────

/**
 * Send daily digests to all verified users
 * Matches tenders to users based on filters, skips users with no new/updated tenders
 * @param {Object} opts
 * @param {Array}  opts.newTenders - all new IT tenders from this run
 * @param {Array}  opts.updatedTenders - all updated tenders [{tender, oldClosingDate, newClosingDate}]
 * @returns {Object} { sent: number, skipped: number, errors: number }
 */
async function sendDailyDigests({ newTenders, updatedTenders }) {
  const users = db.getVerifiedUsers();
  let sent = 0, skipped = 0, errors = 0;

  console.log(`[emailer] Sending digests to ${users.length} verified users`);

  for (const user of users) {
    try {
      // Match tenders to user's filters
      const userFilters = JSON.parse(user.filters || '{}');

      const matchedNew = filterTenders(newTenders, userFilters);
      const matchedUpdated = filterTenders(
        updatedTenders.map(u => u.tender),
        userFilters
      ).map(t => updatedTenders.find(u => u.tender === t));

      // Skip if no tenders for this user
      if (matchedNew.length === 0 && matchedUpdated.length === 0) {
        console.log(`[emailer] Skipping ${user.email} — no matching tenders`);
        skipped++;
        continue;
      }

      const result = await sendDigest(user, {
        newTenders: matchedNew,
        updatedTenders: matchedUpdated,
      });

      if (result.sent) {
        // Log sends to prevent duplicates
        for (const t of matchedNew) {
          const tenderId = db.getDb().prepare('SELECT id FROM tenders WHERE source = ? AND tender_ref = ?').get(t.source, t.tenderId || t.tenderRef);
          if (tenderId) {
            db.logSent(user.id, tenderId.id, t.contentHash || '', false);
          }
        }
        for (const u of matchedUpdated) {
          if (u?.tender) {
            const tenderId = db.getDb().prepare('SELECT id FROM tenders WHERE source = ? AND tender_ref = ?').get(u.tender.source, u.tender.tenderId || u.tender.tenderRef);
            if (tenderId) {
              db.logSent(user.id, tenderId.id, u.tender.contentHash || '', true);
            }
          }
        }
        sent++;
      } else {
        errors++;
      }

      // Rate limit: 100ms between emails
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`[emailer] Error for ${user.email}:`, err.message);
      errors++;
    }
  }

  console.log(`[emailer] Digest batch complete: ${sent} sent, ${skipped} skipped, ${errors} errors`);
  return { sent, skipped, errors };
}

/**
 * Filter tenders based on user's province/category preferences
 */
function filterTenders(tenders, filters) {
  if (!filters || Object.keys(filters).length === 0) return tenders;

  return tenders.filter(t => {
    // Province filter
    if (filters.province && filters.province.length > 0) {
      const dept = (t.department || t.organization || '').toLowerCase();
      const matchesProvince = filters.province.some(p =>
        dept.includes(p.toLowerCase())
      );
      if (!matchesProvince) return false;
    }

    // Category filter
    if (filters.category && filters.category.length > 0) {
      const title = (t.title || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();
      const matchesCategory = filters.category.some(c =>
        title.includes(c.toLowerCase()) || desc.includes(c.toLowerCase())
      );
      if (!matchesCategory) return false;
    }

    return true;
  });
}

module.exports = {
  initResend,
  buildDigestHtml,
  buildDigestText,
  sendDigest,
  sendVerification,
  sendUnsubConfirmation,
  sendAdminAlert,
  sendDailyDigests,
  filterTenders,
};
