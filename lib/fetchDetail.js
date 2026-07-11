/**
 * Fetch full tender detail pages from EPADS and EPMS.
 *
 * Extracts the full text of a tender (scope of work, eligibility, budget, etc.)
 * by fetching the detail page or linked PDF.
 *
 * Returns: { text: string, source: 'html'|'pdf'|'fallback', error: string|null }
 */

const cheerio = require('cheerio');
const config = require('./config');

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': config.scrape.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { response: res, contentType: res.headers.get('content-type') || '' };
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(2000 * attempt);
    }
  }
}

/**
 * Strip HTML to readable text — removes scripts, styles, tags
 */
function htmlToText(html) {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, noscript, nav, header, footer, .nav, .menu, .sidebar, .breadcrumb').remove();

  // Extract text from body (or whole doc if no body)
  const body = $('body').length ? $('body') : $;
  let text = body.text();

  // Clean up whitespace
  text = text
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');

  return text.trim();
}

// ─── EPMS Detail Fetcher ────────────────────────────────────────

/**
 * Fetch EPMS tender detail page and extract full text.
 * @param {string} tenderId - e.g. "TS0000009161E"
 * @returns {{ text: string, source: string, error: string|null }}
 */
async function fetchEPMSDetail(tenderId) {
  const { base, detail } = config.portals.epms;
  const url = `${base}${detail}/${tenderId}`;

  try {
    console.log(`  [fetchDetail] EPMS: ${url}`);
    const { response, contentType } = await fetchWithRetry(url);

    // If PDF, we can't easily extract text — return error to fall back
    if (contentType.includes('pdf')) {
      return { text: '', source: 'pdf', error: 'PDF response — text extraction not supported' };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try to find the main content area
    // EPMS puts tender details in card/section layouts
    let mainContent = '';

    // Strategy 1: Look for specific sections
    const sections = ['Description', 'Scope of Work', 'Eligibility', 'Terms', 'Conditions'];
    for (const section of sections) {
      const heading = $('h1, h2, h3, h4, h5, h6, strong, b, th, label').filter(function () {
        return $(this).text().trim().toLowerCase().includes(section.toLowerCase());
      });
      if (heading.length > 0) {
        const container = heading.first().closest('.card, .panel, .section, .tab-pane, table, div');
        if (container.length) {
          const sectionText = container.text().replace(/\s+/g, ' ').trim();
          if (sectionText.length > 20) {
            mainContent += sectionText + '\n\n';
          }
        }
      }
    }

    // Strategy 2: Extract all table data (EPMS often uses tables for detail fields)
    if (mainContent.length < 100) {
      $('table').each(function () {
        const tableText = $(this).text().replace(/\s+/g, ' ').trim();
        if (tableText.length > 30) {
          mainContent += tableText + '\n\n';
        }
      });
    }

    // Strategy 3: Get all paragraphs and divs with substantial text
    if (mainContent.length < 100) {
      $('p, .detail, .description, .content, [class*="detail"], [class*="content"]').each(function () {
        const text = $(this).text().trim();
        if (text.length > 30) {
          mainContent += text + '\n\n';
        }
      });
    }

    // Strategy 4: Fallback — just extract all body text
    if (mainContent.length < 100) {
      mainContent = htmlToText(html);
    }

    // Truncate to first 4000 chars (enough for AI summarization)
    const text = mainContent.substring(0, 4000);

    return { text, source: 'html', error: null };
  } catch (err) {
    console.warn(`  [fetchDetail] EPMS failed for ${tenderId}: ${err.message}`);
    return { text: '', source: 'error', error: err.message };
  }
}

// ─── EPADS Detail Fetcher ───────────────────────────────────────

/**
 * Fetch EPADS tender detail page and extract full text.
 * @param {string} numericId - e.g. "12345"
 * @returns {{ text: string, source: string, error: string|null }}
 */
async function fetchEPADSDetail(numericId) {
  const { base, detail } = config.portals.epads;
  const url = `${base}${detail}/${numericId}`;

  try {
    console.log(`  [fetchDetail] EPADS: ${url}`);
    const { response, contentType } = await fetchWithRetry(url);

    if (contentType.includes('pdf')) {
      return { text: '', source: 'pdf', error: 'PDF response — text extraction not supported' };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let mainContent = '';

    // Strategy 1: Look for procurement detail sections
    const detailSelectors = [
      '.procurement-detail', '.tender-detail', '.detail-section',
      '[class*="detail"]', '[class*="procurement"]', '[class*="tender"]',
      'main', 'article', '.content',
    ];

    for (const selector of detailSelectors) {
      const el = $(selector);
      if (el.length) {
        const text = el.text().replace(/\s+/g, ' ').trim();
        if (text.length > mainContent.length && text.length > 50) {
          mainContent = text;
        }
      }
    }

    // Strategy 2: Extract table data
    if (mainContent.length < 100) {
      $('table').each(function () {
        const tableText = $(this).text().replace(/\s+/g, ' ').trim();
        if (tableText.length > 30) {
          mainContent += tableText + '\n\n';
        }
      });
    }

    // Strategy 3: Fallback
    if (mainContent.length < 100) {
      mainContent = htmlToText(html);
    }

    // Truncate
    const text = mainContent.substring(0, 4000);

    return { text, source: 'html', error: null };
  } catch (err) {
    console.warn(`  [fetchDetail] EPADS failed for ${numericId}: ${err.message}`);
    return { text: '', source: 'error', error: err.message };
  }
}

// ─── PDF Fallback ───────────────────────────────────────────────

/**
 * Attempt to download a PDF and extract text using a simple extraction.
 * Since we don't have a PDF parser, we return the raw bytes metadata.
 * In practice, this is a fallback path — we log the attempt and move on.
 */
async function tryFetchPdf(url) {
  try {
    const { response, contentType } = await fetchWithRetry(url);
    if (!contentType.includes('pdf')) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // Basic PDF text extraction (very rough — finds text between parentheses in PDF stream)
    const raw = buffer.toString('latin1');
    const texts = [];
    const textRegex = /\(([^)]{3,})\)/g;
    let match;
    while ((match = textRegex.exec(raw)) !== null) {
      const t = match[1].replace(/\\[()\\]/g, '').trim();
      if (t.length > 3 && !t.startsWith('%')) {
        texts.push(t);
      }
    }
    return texts.join(' ').substring(0, 4000) || null;
  } catch {
    return null;
  }
}

// ─── Unified Fetch ──────────────────────────────────────────────

/**
 * Fetch detail text for a tender, handling both EPADS and EPMS.
 * Falls back gracefully: if detail page fails, returns empty string.
 *
 * @param {Object} tender - tender object with source, tenderId, url, description
 * @returns {{ text: string, source: string, error: string|null }}
 */
async function fetchTenderDetail(tender) {
  const tenderRef = tender.tenderId || tender.tenderRef || '';

  // Try detail page first
  let result;
  if (tender.source === 'epms') {
    result = await fetchEPMSDetail(tenderRef);
  } else if (tender.source === 'epads') {
    // EPADS uses numericId for detail pages
    const numericId = tender.numericId || tenderRef.replace(/^P/, '');
    result = await fetchEPADSDetail(numericId);
  } else {
    return { text: '', source: 'unknown', error: `Unknown source: ${tender.source}` };
  }

  // If detail page returned useful text, use it
  if (result.text && result.text.length > 50) {
    return result;
  }

  // Try linked PDF if the detail page had a PDF link
  if (result.error && result.error.includes('PDF')) {
    const pdfUrl = tender.url;
    const pdfText = await tryFetchPdf(pdfUrl);
    if (pdfText) {
      return { text: pdfText, source: 'pdf', error: null };
    }
  }

  // Final fallback: use the description we already have from the listing
  console.log(`  [fetchDetail] Falling back to listing description for ${tenderRef}`);
  return {
    text: tender.description || '',
    source: 'fallback',
    error: result.error || 'Detail page returned insufficient content',
  };
}

module.exports = {
  fetchTenderDetail,
  fetchEPMSDetail,
  fetchEPADSDetail,
  tryFetchPdf,
  htmlToText,
};
