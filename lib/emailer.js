const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');

let transporter = null;
let resendClient = null;

// ─── Transport Initialization ───────────────────────────────────

/**
 * Try Resend first (better deliverability), fallback to Gmail SMTP.
 */
function initResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

function initGmailTransporter() {
  const user = config.email.smtpUser;
  const pass = config.email.smtpPass;
  if (!user || !pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass },
    });
  }
  return transporter;
}

// ─── Email Template ─────────────────────────────────────────────

function buildDigestHtml({ userName, newTenders, updatedTenders, unsubscribeUrl, siteUrl }) {
  const date = new Date().toLocaleDateString('en-PK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let newSection = '';
  if (newTenders.length > 0) {
    newSection = `
      <div style="margin-bottom:24px">
        <h2 style="color:#1e40af;font-size:16px;margin-bottom:12px">NEW IT TENDERS (${newTenders.length})</h2>
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
        <h2 style="color:#b45309;font-size:16px;margin-bottom:12px">UPDATED TENDERS (${updatedTenders.length})</h2>
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
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:24px 32px;color:white">
      <div style="font-size:24px;margin-bottom:4px">🇵🇰</div>
      <div style="font-size:18px;font-weight:700">PITAS Daily Tender Alert</div>
      <div style="font-size:13px;opacity:0.85;margin-top:4px">${date}</div>
    </div>
    <div style="padding:24px 32px">
      <p style="font-size:15px;color:#334155;margin-bottom:20px">Hi ${escapeHtml(userName || 'there')},</p>
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
    <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0">
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0 0 8px 0">
        You're receiving this because you registered at <a href="${escapeHtml(siteUrl)}" style="color:#6366f1">${escapeHtml(siteUrl)}</a>.
      </p>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6366f1">Unsubscribe</a> · PITAS — PPRA IT-Tender Autonomous Sentinel
      </p>
    </div>
  </div>
</body>
</html>`;
}

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

// ─── Core Send ──────────────────────────────────────────────────

async function sendMail({ to, subject, html, text, unsubscribeUrl, siteUrl }) {
  const fromName = config.email.fromName || 'PITAS Tender Alert';
  const fromEmail = config.email.smtpUser;
  const from = `${fromName} <${fromEmail}>`;
  const unsub = `<${unsubscribeUrl || (siteUrl || config.siteUrl) + '/unsubscribe'}>`;

  // 1) Try Resend first (much better deliverability)
  const resend = initResend();
  if (resend) {
    try {
      const result = await resend.emails.send({
        from: `${fromName} <onboarding@resend.dev>`,
        to: [to],
        subject,
        html,
        text,
        headers: {
          'List-Unsubscribe': unsub,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      console.log(`[emailer] ✅ Sent via Resend to ${to}: ${subject} (id: ${result.id})`);
      return { sent: true, messageId: result.id, provider: 'resend' };
    } catch (err) {
      console.error(`[emailer] ⚠️ Resend failed for ${to}:`, err.message, '— falling back to Gmail');
    }
  }

  // 2) Fallback to Gmail SMTP
  const t = initGmailTransporter();
  if (!t) {
    console.log(`[emailer] DRY RUN — no transport available for ${to}: ${subject}`);
    return { sent: false, error: 'No email transport configured' };
  }

  try {
    const info = await t.sendMail({
      from,
      to,
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': unsub,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Mailer': 'PITAS-Tender-Alert/1.0',
        'Precedence': 'bulk',
        'Auto-Submitted': 'auto-generated',
      },
    });
    console.log(`[emailer] ✅ Sent via Gmail to ${to}: ${subject} (id: ${info.messageId})`);
    return { sent: true, messageId: info.messageId, provider: 'gmail' };
  } catch (err) {
    console.error(`[emailer] ❌ Gmail failed for ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

// ─── Send Functions ─────────────────────────────────────────────

async function sendDigest(user, { newTenders, updatedTenders }) {
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
  const subject = `IT Tender Alert — ${new Date().toLocaleDateString('en-PK')} — ${total} tender${total !== 1 ? 's' : ''}`;

  return sendMail({ to: user.email, subject, html, text, unsubscribeUrl, siteUrl });
}

async function sendVerification(user) {
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
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">If you didn't register, ignore this email.</p>
  </div>
</body></html>`;

  return sendMail({
    to: user.email,
    subject: 'Verify your PITAS subscription',
    html,
    siteUrl,
    unsubscribeUrl: `${siteUrl}/unsubscribe/${user.unsubscribe_token}`,
  });
}

async function sendUnsubConfirmation(user) {
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
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">Changed your mind? Just ignore this email.</p>
  </div>
</body></html>`;

  return sendMail({
    to: user.email,
    subject: 'Unsubscribe from PITAS Tender Alerts',
    html,
    siteUrl,
    unsubscribeUrl: unsubUrl,
  });
}

async function sendAdminAlert(errorMsg) {
  const adminEmail = config.admin?.email;
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
    <p style="color:#475569;font-size:14px;margin-bottom:16px">The PITAS daily pipeline encountered an error:</p>
    <pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;font-size:13px;color:#991b1b;overflow-x:auto">${escapeHtml(errorMsg)}</pre>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">${new Date().toISOString()}</p>
  </div>
</body></html>`;

  return sendMail({
    to: adminEmail,
    subject: 'PITAS Pipeline Alert',
    html,
    siteUrl: config.siteUrl,
    unsubscribeUrl: `${config.siteUrl}/unsubscribe`,
  });
}

// ─── Batch Digest ───────────────────────────────────────────────

async function sendDailyDigests({ newTenders, updatedTenders }) {
  const users = db.getVerifiedUsers();
  let sent = 0, skipped = 0, errors = 0;

  console.log(`[emailer] Sending digests to ${users.length} verified users`);

  for (const user of users) {
    try {
      const userFilters = JSON.parse(user.filters || '{}');

      const matchedNew = filterTenders(newTenders, userFilters);
      const matchedUpdated = filterTenders(
        updatedTenders.map(u => u.tender),
        userFilters
      ).map(t => updatedTenders.find(u => u.tender === t));

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
        for (const t of matchedNew) {
          const tenderId = db.getDb().prepare('SELECT id FROM tenders WHERE source = ? AND tender_ref = ?').get(t.source, t.tenderId || t.tenderRef);
          if (tenderId) db.logSent(user.id, tenderId.id, t.contentHash || '', false);
        }
        for (const u of matchedUpdated) {
          if (u?.tender) {
            const tenderId = db.getDb().prepare('SELECT id FROM tenders WHERE source = ? AND tender_ref = ?').get(u.tender.source, u.tender.tenderId || u.tender.tenderRef);
            if (tenderId) db.logSent(user.id, tenderId.id, u.tender.contentHash || '', true);
          }
        }
        sent++;
      } else {
        errors++;
      }

      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`[emailer] Error for ${user.email}:`, err.message);
      errors++;
    }
  }

  console.log(`[emailer] Digest batch complete: ${sent} sent, ${skipped} skipped, ${errors} errors`);
  return { sent, skipped, errors };
}

function filterTenders(tenders, filters) {
  if (!filters || Object.keys(filters).length === 0) return tenders;

  return tenders.filter(t => {
    if (filters.province && filters.province.length > 0) {
      const dept = (t.department || t.organization || '').toLowerCase();
      const matchesProvince = filters.province.some(p => dept.includes(p.toLowerCase()));
      if (!matchesProvince) return false;
    }
    if (filters.category && filters.category.length > 0) {
      const title = (t.title || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();
      const matchesCategory = filters.category.some(c => title.includes(c.toLowerCase()) || desc.includes(c.toLowerCase()));
      if (!matchesCategory) return false;
    }
    return true;
  });
}

module.exports = {
  initTransporter,
  buildDigestHtml,
  buildDigestText,
  sendDigest,
  sendVerification,
  sendUnsubConfirmation,
  sendAdminAlert,
  sendDailyDigests,
  filterTenders,
};
