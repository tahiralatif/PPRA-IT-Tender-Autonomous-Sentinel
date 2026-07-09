const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(url, retries = config.scrape.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': config.scrape.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      return await res.text();
    } catch (err) {
      console.error(`  [attempt ${attempt}/${retries}] Fetch failed: ${err.message}`);
      if (attempt < retries) {
        const delay = config.scrape.delayMs * attempt;
        console.log(`  Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Save raw HTML snapshot for debugging
 */
function saveSnapshot(source, html, label) {
  const dir = path.join(config.paths.snapshots, source);
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${label}_${timestamp}.html`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, html, 'utf-8');
  console.log(`  Snapshot saved: ${filepath}`);

  // Prune old snapshots (keep last 30 days)
  pruneSnapshots(dir, 30);
}

/**
 * Remove snapshot files older than maxAgeDays
 */
function pruneSnapshots(dir, maxAgeDays) {
  if (!fs.existsSync(dir)) return;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filepath);
      console.log(`  Pruned old snapshot: ${file}`);
    }
  }
}

// ─── EPMS Scraper ───────────────────────────────────────────────

/**
 * Scrape EPMS active tenders filtered to Info and Comm Tech (sector=14)
 * Returns array of tender objects from the listing page.
 */
async function scrapeEPMSListing() {
  const { base, listing, sectorFilter } = config.portals.epms;
  const url = `${base}${listing}?sector=${sectorFilter}`;

  console.log(`[EPMS] Fetching listing: ${url}`);
  const html = await fetchWithRetry(url);

  // Save snapshot
  saveSnapshot('epms', html, 'listing-sector14');

  const $ = cheerio.load(html);
  const tenders = [];

  // Parse table rows — EPMS uses <tr> with <td> cells
  // Structure: # | Tender ID | Title | Organization | Status | Published | Closing
  $('table tbody tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return; // skip malformed rows

    const rowText = (idx) =>
      $(cells[idx])
        .text()
        .trim()
        .replace(/\s+/g, ' ');

    // Extract tender ID from the detail link
    const detailLink = $(row).find('a[href*="tender-details"]').attr('href');
    const tenderIdMatch = detailLink
      ? detailLink.match(/tender-details\/([A-Z0-9]+)/)
      : null;
    const tenderId = tenderIdMatch ? tenderIdMatch[1] : null;

    if (!tenderId) return; // skip if no ID found

    // Clean title: remove trailing sector badge text and extra whitespace
    let title = rowText(2)
      .replace(/Info and Comm Tech.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    tenders.push({
      source: 'epms',
      tenderId,
      title,
      organization: rowText(3),
      status: rowText(4),
      publishedDate: rowText(5),
      closingDate: rowText(6).replace(/\s+/g, ' ').trim(),
      url: `${base}/public/tenders/tender-details/${tenderId}`,
      sector: 'Info and Comm Tech', // pre-filtered
    });
  });

  console.log(`[EPMS] Found ${tenders.length} tenders from listing`);
  return tenders;
}

/**
 * Scrape a single EPMS tender detail page for full description
 */
async function scrapeEPMSDetail(tenderId) {
  const { base, detail } = config.portals.epms;
  const url = `${base}${detail}/${tenderId}`;

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  // Extract description — EPMS puts it in a card/section labeled "Description"
  let description = '';

  // Try to find the description section
  const descHeading = $('h1, h2, h3, h4, h5, h6, strong, b').filter(function () {
    return $(this).text().trim().toLowerCase().includes('description');
  });

  if (descHeading.length > 0) {
    // Get the next sibling content
    const parent = descHeading.first().closest('.card, .section, div');
    description = parent.text().trim().replace(/\s+/g, ' ');
    // Clean up: remove the heading itself
    const headingText = descHeading.first().text().trim();
    description = description.replace(headingText, '').trim();
  }

  // Fallback: look for any large text block
  if (!description || description.length < 20) {
    $('p, .description, .desc, [class*="desc"]').each(function () {
      const text = $(this).text().trim();
      if (text.length > description.length && text.length > 30) {
        description = text;
      }
    });
  }

  // Extract category/type if available
  let category = '';
  const catMatch = html.match(/(?:Category|Type)[^<]*<\/[^>]+>\s*<[^>]+>([^<]+)/i);
  if (catMatch) {
    category = catMatch[1].trim();
  }

  return {
    description: description.replace(/\s+/g, ' ').trim(),
    category,
    detailHtml: html,
  };
}

/**
 * Full EPMS scrape: listing only (detail pages skipped for v1 — listing has all needed fields)
 * Detail pages can be enabled later if description data is needed for AI classification.
 */
async function scrapeEPMS() {
  console.log('\n=== EPMS Scraper ===');
  const tenders = await scrapeEPMSListing();

  if (tenders.length === 0) {
    console.warn('[EPMS] WARNING: 0 tenders scraped. Site structure may have changed!');
  }

  return tenders;
}

// ─── EPADS Scraper ──────────────────────────────────────────────

/**
 * Scrape EPADS v2.0 listing page
 * EPADS serves 100 procurement entries inline with no filters.
 */
async function scrapeEPADSListing() {
  const { base, listing } = config.portals.epads;
  const url = `${base}${listing}`;

  console.log(`[EPADS] Fetching listing: ${url}`);
  const html = await fetchWithRetry(url);

  saveSnapshot('epads', html, 'listing');

  // EPADS uses a different HTML structure — extract from text flow
  // Pattern: P followed by digits, then title, org, dates, type
  const $ = cheerio.load(html);
  const tenders = [];

  // Find all procurement links and extract data from link text + parent row
  $('a[href*="opportunities/federal/procurements/"]').each((i, el) => {
    const href = $(el).attr('href');
    const idMatch = href.match(/procurements\/(\d+)/);
    if (!idMatch) return;

    const numericId = idMatch[1];
    const linkText = $(el).text().trim();

    // Skip navigation/empty links
    if (!linkText || linkText.length < 5) return;

    // Get the parent table row for additional context
    const row = $(el).closest('tr');
    const rowText = row.text().replace(/\s+/g, ' ').trim();

    // Extract procurement ref (P + digits)
    const refMatch = rowText.match(/(P\d{4,6})/);
    const ref = refMatch ? refMatch[1] : `P${numericId}`;

    // Title is the link text itself
    const title = linkText;

    // Extract organization — text after title, before 'Published On:'
    const orgMatch = rowText.match(
      new RegExp(
        title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(.+?)\\s+Published On',
        'i'
      )
    );
    const organization = orgMatch ? orgMatch[1].trim() : '';

    // Extract dates
    const publishedMatch = rowText.match(/Published On:\s*(.+?)\s*Closing On/i);
    const closingMatch = rowText.match(/Closing On:\s*(.+?)(?:\s+(?:Consultancy|Goods|Works|Non-consultancy)|$)/i);

    // Extract type
    const typeMatch = rowText.match(
      /(Consultancy Services|Non-consultancy Services|Goods|Works)/i
    );

    tenders.push({
      source: 'epads',
      tenderId: ref,
      numericId,
      title,
      organization,
      status: 'Active',
      publishedDate: publishedMatch ? publishedMatch[1].trim() : '',
      closingDate: closingMatch ? closingMatch[1].trim() : '',
      url: `${config.portals.epads.base}/opportunities/federal/procurements/${numericId}`,
      sector: typeMatch ? typeMatch[1] : '',
    });
  });

  // Deduplicate by numericId (EPADS may show duplicates)
  const seen = new Set();
  const unique = tenders.filter((t) => {
    if (seen.has(t.numericId)) return false;
    seen.add(t.numericId);
    return true;
  });

  console.log(`[EPADS] Found ${unique.length} unique tenders from listing`);
  return unique;
}

/**
 * Scrape EPADS detail page
 */
async function scrapeEPADSDetail(numericId) {
  const { base, detail } = config.portals.epads;
  const url = `${base}${detail}/${numericId}`;

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  let description = '';
  let organization = '';

  // Extract description from page text
  $('p, .description, [class*="desc"]').each(function () {
    const text = $(this).text().trim();
    if (text.length > description.length && text.length > 30) {
      description = text;
    }
  });

  // Extract organization from contact/department info
  const orgMatch = html.match(/Department[^<]*<\/[^>]+>\s*<[^>]+>([^<]+)/i);
  if (orgMatch) {
    organization = orgMatch[1].trim();
  }

  return {
    description: description.replace(/\s+/g, ' ').trim(),
    organization,
    detailHtml: html,
  };
}

/**
 * Full EPADS scrape — listing only for v1
 */
async function scrapeEPADS() {
  console.log('\n=== EPADS Scraper ===');
  const tenders = await scrapeEPADSListing();

  if (tenders.length === 0) {
    console.warn('[EPADS] WARNING: 0 tenders scraped.');
  }

  return tenders;
}

// ─── Combined Scraper ───────────────────────────────────────────

/**
 * Scrape both portals and return combined tender array
 */
async function scrapeAll() {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`PITAS Scraper — ${new Date().toISOString()}`);
  console.log(`${'='.repeat(50)}`);

  const results = { epms: [], epads: [], errors: [] };

  // Scrape EPMS (primary)
  try {
    results.epms = await scrapeEPMS();
  } catch (err) {
    console.error(`[EPMS] FATAL: ${err.message}`);
    results.errors.push({ source: 'epms', error: err.message });
  }

  // Delay between portals
  await sleep(config.scrape.delayMs);

  // Scrape EPADS (secondary)
  try {
    results.epads = await scrapeEPADS();
  } catch (err) {
    console.error(`[EPADS] FATAL: ${err.message}`);
    results.errors.push({ source: 'epads', error: err.message });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const total = results.epms.length + results.epads.length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scrape complete in ${elapsed}s`);
  console.log(`  EPMS:  ${results.epms.length} tenders`);
  console.log(`  EPADS: ${results.epads.length} tenders`);
  console.log(`  Total: ${total} tenders`);
  console.log(`  Errors: ${results.errors.length}`);
  console.log(`${'='.repeat(50)}\n`);

  return results;
}

module.exports = {
  scrapeAll,
  scrapeEPMS,
  scrapeEPADS,
  scrapeEPMSListing,
  scrapeEPMSDetail,
  scrapeEPADSListing,
  scrapeEPADSDetail,
};
