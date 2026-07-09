# Task 0 — Data Source Validation Report

**Date:** 2026-07-09
**Status:** ✅ COMPLETE

---

## Summary

Both tender portals (EPMS and EPADS) serve data via **server-side rendered HTML**. No Playwright/browser automation is needed — a simple `fetch` + HTML parser is sufficient. EPMS offers a working sector filter (`sector=14` for "Info and Comm Tech") that reduces the scraping surface dramatically. EPADS has no keyword/sector filters but serves 100 entries inline.

**Decision: Playwright is NOT required for v1. Use `fetch` + `cheerio` (Node) or `BeautifulSoup` (Python).**

---

## Source 1: PPRA-EPMS (`epms.ppra.gov.pk`)

### Rendering
- **Server-side rendered:** ✅ Confirmed. All tender data is present in the initial HTML response. No JavaScript loading required.
- **Playwright needed:** ❌ No.

### Data Structure
- **Listing URL:** `https://epms.ppra.gov.pk/public/tenders/active-tenders`
- **Detail URL:** `https://epms.ppra.gov.pk/public/tenders/tender-details/{TENDER_ID}`
- **Tender ID format:** `TS` + digits + letter (e.g., `TS0000009230E`)
- **Fields available on listing page:** row number, tender ID, title, organization, publish status, publish date, closing date
- **Fields available on detail page:** title, tender ref, organization/office details, tender information, description, important dates, financial information, corrigenda

### Filters (URL query parameters)
| Filter | Parameter | Example | Works? |
|---|---|---|---|
| Keyword | `keyword` | `?keyword=software` | ✅ Returns 9 tenders |
| Sector (Info and Comm Tech) | `sector=14` | `?sector=14` | ✅ Returns 39 tenders |
| Tender Number | `tender_number` | `?tender_number=TS0000009230E` | Untested (likely works) |
| Closing Date | `closing_date` | `?closing_date=2026-07-24` | Untested |
| Tender Type | `tender_type` | `?tender_type=1` | Untested |
| Category | `category` | `?category=1` | Untested |
| Nature | `nature` | `?nature=local` | Untested |
| Organization | `organization` | `?organization=...` | Untested |

**Key finding:** The `sector=14` filter is a **cheat code** — it returns only "Info and Comm Tech" tenders directly from the server, eliminating the need for most keyword/AI classification on EPMS data.

### Volume
- Active tenders (all sectors): ~50
- Info and Comm Tech only (`sector=14`): 39
- Keyword "software": 9

### robots.txt
- **URL:** `https://epms.ppra.gov.pk/robots.txt`
- **Result:** 404 (no robots.txt file exists)
- **Implication:** No explicit blocking. Standard default applies (all paths accessible).

### Terms of Service
- **Result:** No explicit TOS page found. PPRA FAQ page discusses procurement rules but contains no anti-scraping, bot, or automated access clauses.
- **Implication:** No legal barrier identified. Scraping public tender data is low-risk.

---

## Source 2: EPADS v2.0 (`epads.gov.pk`)

### Rendering
- **Server-side rendered:** ✅ Confirmed. 100 procurement entries are inline in the HTML.
- **Playwright needed:** ❌ No.

### Data Structure
- **Listing URL:** `https://epads.gov.pk/`
- **Detail URL:** `https://epads.gov.pk/opportunities/federal/procurements/{NUMERIC_ID}`
- **Tender ID format:** `P` + digits (e.g., `P53495`)
- **Fields available on listing page:** procurement ref, title, organization, published date, closing date, type (e.g., "Consultancy Services"), procedure (e.g., "Single Stage-Two Envelope")
- **Fields available on detail page:** contact info (name, email, phone), procurement description, grievance info

### Filters
| Filter | Available? | Notes |
|---|---|---|
| Keyword search | ❌ Not visible | No search input on the homepage |
| Sector/category | ❌ Not visible | No dropdown filter |
| Pagination | ❌ Not visible | Shows exactly 100 entries |

**Key limitation:** EPADS homepage shows exactly 100 entries with no keyword filter and no pagination. If more than 100 procurements are open, older ones may drop off the listing. This means EPADS may not capture all active tenders.

**Workaround:** Scrape EPADS daily. New tenders appear at the top. The 100-entry limit means we capture the most recent active procurements. For comprehensive coverage, EPMS (which has filters and shows more entries) is the primary source.

### Volume
- Open procurements displayed: 100
- Unique procurement refs: 100

### robots.txt
- **URL:** `https://epads.gov.pk/robots.txt`
- **Result:** 404 (no robots.txt file exists)
- **Implication:** No explicit blocking.

### Terms of Service
- **Result:** No TOS page found. All routes (`/terms`, `/terms-of-service`, `/legal`, `/privacy`) return the same generic page.
- **Implication:** No legal barrier identified.

---

## Cross-Source Deduplication

Tenders may appear on both EPMS and EPADS (same procurement, different portal). Strategy:

1. **Primary dedup key:** Tender title (normalized: lowercase, strip whitespace/punctuation) + department name
2. **Secondary key:** Content hash of title + first 200 chars of description
3. **Source tracking:** Store which source each tender came from. If the same tender appears on both, mark as `sources: ['epms', 'epads']` and only send once.

---

## Decision Matrix

| Question | Answer |
|---|---|
| Which parser to use? | `fetch` + HTML parser (cheerio/BeautifulSoup). **No Playwright.** |
| Does EPMS have a working sector filter? | ✅ Yes — `?sector=14` for "Info and Comm Tech" |
| Does EPADS have keyword filters? | ❌ No — serves a flat list of 100 entries |
| Which is the primary source? | **EPMS** — has filters, more entries, better data structure |
| Which is the secondary source? | **EPADS** — catches tenders from agencies not yet on EPMS |
| Is Playwright needed? | **No** for v1. Revisit if portals switch to SPA/JS rendering. |
| Are there anti-scraping barriers? | **None identified.** No robots.txt blocks, no TOS restrictions, no CAPTCHAs. |
| Total daily scraping footprint? | ~4 requests (2 per portal, with filters pre-applied) |

---

## Risk Notes

1. **EPADS 100-entry limit:** If more than 100 procurements are open, some will be missed. Monitor this. EPMS is more reliable for comprehensive coverage.
2. **EPMS HTML structure changes:** Government portals redesign without warning. Store raw HTML snapshots for debugging. Alert on 0 tenders scraped.
3. **EPADS may deprecate:** The portal is newer but less feature-rich. If it gains filters/pagination, update the scraper. If it's abandoned, drop it.
4. **No API found on either portal:** Both are pure server-rendered HTML. No hidden JSON API discovered in JS files or network patterns.

---

## Recommendation

**Start building with EPMS as primary source** using `fetch` + `cheerio`. The `sector=14` filter does 90% of the classification work server-side. Add EPADS as a secondary source to catch agencies not on EPMS. Skip Playwright entirely for v1.
