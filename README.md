# 🇵🇰 PITAS — PPRA IT-Tender Autonomous Sentinel

> **Live → [pitas.14.jugaar.ai](https://pitas.14.jugaar.ai)**

Automated daily alert system for IT-relevant government tenders from Pakistan's PPRA/EPADS procurement portals.

Pakistan's public procurement portals list thousands of active tenders across every sector. Finding the ones relevant to your IT business means manually scanning EPMS and EPADS every day, filtering out construction tenders and food procurement, and hoping you don't miss one. PITAS does this automatically — it scrapes both portals twice daily, classifies tenders using keyword matching + AI, deduplicates across sources, and emails a clean digest of only IT-relevant tenders to registered subscribers.

## Features

- **Automated daily scraping** — EPMS (primary, with native sector filter `Info and Comm Tech`) and EPADS v2.0 (secondary, no filter available). Uses `fetch` + `cheerio` (no browser automation needed — both portals serve server-rendered HTML).
- **Three-tier classification** — Hard-include keywords (91 IT terms), hard-exclude keywords (non-IT categories like food, construction, medicine), and Groq/Llama-3 AI classification for ambiguous cases.
- **Deduplication** — Tenders matched by `(source, tender_ref)` to prevent repeats. Deadline changes and addenda are tracked and flagged as updates.
- **Email digests** — Resend (primary, better deliverability) with Gmail SMTP fallback. Includes new tenders, deadline changes, and unsubscribe link.
- **Email verification** — Double opt-in registration. Unverified users are not emailed.
- **One-click unsubscribe** — Unsubscribe link in every email. Confirmation page with token-based authentication.
- **Rate limiting + honeypot** — Anti-spam protection on registration, unsubscribe, and Check Now endpoints.
- **On-demand "Check Now"** — Instant tender lookup via the web UI. Scrapes fresh data if older than 30 minutes, returns cached results otherwise. Rate limited to 3 requests/hour/IP.
- **Scheduled cron jobs** — Runs at 7:00 AM and 3:00 PM PKT daily (02:00 and 08:00 UTC). Also runs weekly log rotation on Sundays.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Web framework | Express.js |
| Scraping | `fetch` + `cheerio` (HTML parsing) |
| AI classification | Groq API (Llama-3 model) |
| Database | SQLite via `better-sqlite3` |
| Email (primary) | Resend API |
| Email (fallback) | Gmail SMTP via `nodemailer` |
| Process manager | PM2 |
| Reverse proxy | nginx |
| Anti-spam | `express-rate-limit` + honeypot fields |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SCHEDULED / ON-DEMAND                   │
│                                                               │
│   Cron (7 AM / 3 PM PKT)  or  GET /api/check-now            │
│                    │                    │                     │
│                    ▼                    ▼                     │
│           ┌─────────────────────────────────┐                │
│           │       lib/pipeline.js            │                │
│           │   (shared scrape→classify→store) │                │
│           └──────────────┬──────────────────┘                │
│                          │                                    │
│              ┌───────────▼───────────┐                       │
│              │   1. SCRAPE           │                       │
│              │   EPMS (cheerio)      │                       │
│              │   EPADS (cheerio)     │                       │
│              └───────────┬───────────┘                       │
│                          │ raw tenders                        │
│              ┌───────────▼───────────┐                       │
│              │   2. CLASSIFY         │                       │
│              │   Tier 1: Keywords    │──── hard-include ──┐  │
│              │   Tier 2: Exclude     │──── hard-exclude ──┤  │
│              │   Tier 3: Groq AI     │◀─── ambiguous ─────┘  │
│              └───────────┬───────────┘                       │
│                          │ relevant tenders                   │
│              ┌───────────▼───────────┐                       │
│              │   3. DEDUPLICATE      │                       │
│              │   upsert by ref+src   │                       │
│              │   track deadline Δ    │                       │
│              └───────────┬───────────┘                       │
│                          │                                    │
│              ┌───────────▼───────────┐                       │
│              │   4. DATABASE         │                       │
│              │   SQLite (pitas.db)   │                       │
│              └───────────┬───────────┘                       │
│                          │                                    │
│              ┌───────────▼───────────┐                       │
│              │   5. EMAIL            │                       │
│              │   Resend → Gmail SMTP │                       │
│              │   Daily digests       │                       │
│              └───────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### Prerequisites

- Node.js 18+
- npm
- A Gmail account with 2FA + App Password
- A [Groq API key](https://console.groq.com) (free tier works)
- (Optional) A [Resend API key](https://resend.com) for better email deliverability

### Install

```bash
git clone https://github.com/tahiralatif/PPRA-IT-Tender-Autonomous-Sentinel.git
cd PPRA-IT-Tender-Autonomous-Sentinel
npm install
```

### Environment Variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `SITE_URL` | Public URL where the app is accessible (e.g. `https://your-domain/pitas`) |
| `PORT` | Port the app listens on (default: `3000`) |
| `ADMIN_EMAIL` | Admin email for alerts and notifications |
| `GMAIL_USER` | Gmail address for SMTP fallback |
| `GMAIL_APP_PASSWORD` | Gmail App Password (requires 2FA) |
| `EMAIL_FROM_NAME` | Display name for emails (default: `PITAS Tender Alert`) |
| `GROQ_API_KEY` | Groq API key for AI classification |
| `DB_PATH` | SQLite database path (default: `./data/pitas.db`) |
| `SCRAPE_DELAY_MS` | Delay between scraping requests in ms (default: `3000`) |
| `MAX_RETRIES` | Max retry attempts for failed HTTP requests (default: `2`) |

Optional:

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key (if set, used as primary email sender) |

### Run Locally

```bash
# Start the web server
npm start

# Run the daily pipeline manually (dry run — no emails sent)
npm run daily:dry

# Run the daily pipeline (live — sends emails)
npm run daily

# Test scraper only
npm run test:scrape
```

The app will be available at `http://localhost:3000`.

### Deploy (Production)

The app runs on a VPS with PM2 + nginx:

```bash
# Install PM2 globally if not already
npm install -g pm2

# Start with PM2
cd /path/to/pitas
pm2 start ecosystem.config.js

# Set up cron jobs
crontab -e
# Add:
# 0 2 * * * cd /opt/pitas && /usr/local/bin/node scripts/daily-run.js >> logs/daily-run.log 2>&1
# 0 8 * * * cd /opt/pitas && /usr/local/bin/node scripts/daily-run.js >> logs/daily-run.log 2>&1
```

PM2 config (`ecosystem.config.js`) auto-restarts on crash, limits memory to 200 MB, and manages log rotation.

## API Endpoints

All endpoints are prefixed with the app's base path (e.g. `/pitas/api/...`).

| Method | Endpoint | Rate Limit | Description |
|--------|----------|-----------|-------------|
| `GET` | `/api/health` | — | Health check. Returns `{"status":"ok"}` with timestamp. |
| `GET` | `/api/stats` | — | Dashboard stats: total tenders, verified users, last run info. |
| `POST` | `/api/register` | 10/hour/IP | Register for daily alerts. Body: `{"email":"..."}`. Creates unverified user, sends verification email. |
| `GET` | `/api/verify/:token` | — | Verify email address. Returns "All Set!" confirmation page. |
| `POST` | `/api/unsubscribe` | 20/hour/IP | Request unsubscribe (sends confirmation link to prevent false unsubscribes). |
| `GET` | `/api/unsubscribe/:token` | — | One-click unsubscribe from email link. |
| `GET` | `/api/check-now` | 3/hour/IP | On-demand tender check. Scrapes fresh if data >30 min old, returns cached otherwise. Returns JSON with tenders array. |

## Deployment Notes

- **Live URL:** [pitas.14.jugaar.ai](https://pitas.14.jugaar.ai)
- **VPS:** Deployed alongside the Website Audit Portal on the same server
- **Reverse proxy:** nginx serves both apps on different paths (`/pitas` for PITAS, `/` for the audit portal)
- **Port:** Runs on port 3001 (internal), proxied through nginx
- **Process management:** PM2 with auto-restart, exponential backoff, and 200 MB memory limit
- **Logs:** `logs/web-out.log` (stdout), `logs/web-error.log` (stderr), `logs/daily-run.log` (cron output)
- **Database:** SQLite at `data/pitas.db` — no external database server required
- **Deploy workflow:** Push to `main` → SSH to server → pull latest → restart PM2

## Cron Schedule

| Time (PKT) | Time (UTC) | Command | Description |
|-----------|-----------|---------|-------------|
| 7:00 AM | 02:00 UTC | `daily-run.js` | Morning scrape + classify + email digest |
| 3:00 PM | 08:00 UTC | `daily-run.js` | Afternoon scrape + classify + email digest |
| Sunday midnight | Sunday 00:00 UTC | `rotate-logs.sh` | Weekly log rotation |

The cron calls `runPipeline()` directly (not via HTTP), so it never counts against the rate limiter meant for manual "Check Now" clicks.

## Known Limitations

- **Gmail SMTP deliverability** — Emails sent via Gmail are more likely to land in spam due to shared IP reputation and limited DKIM/DMARC alignment. Resend is configured as the primary sender when `RESEND_API_KEY` is set. For production use at scale, a dedicated ESP (Resend, Postmark, SendGrid) with proper SPF/DKIM/DMARC is recommended.
- **Portal structure changes** — EPMS and EPADS may change their HTML structure, URLs, or API responses without notice. When this happens, the scraper will fail and the admin alert email will fire. Fixes require updating the cheerio selectors in `lib/scraper.js`.
- **Keyword tuning** — The 91-keyword include list and exclude list are periodically reviewed. Edge cases (e.g. "Computer Center renovation" being classified as IT) are expected. The Groq AI classifier handles ambiguous cases but can also produce false positives for tenders that mention IT-adjacent terms in non-IT contexts.
- **AI classification costs** — The Groq API free tier has rate limits. During full scrapes, hundreds of tenders may need AI classification, which can take 3-5 minutes and hit rate limits. A graceful fallback to keyword-only classification is implemented if the AI is unavailable.
- **Single-instance deployment** — The app runs as a single PM2 instance. SQLite is file-based, so this limits horizontal scaling. Adequate for the expected user base.
- **No tender detail scraping** — The scraper captures tender titles, departments, deadlines, and references from listing pages. It does not fetch individual tender detail pages (specifications, documents, etc.).

## Contributing

### Workflow

All changes go through feature branches and pull requests. No direct commits to `main`.

```
git checkout -b fix/short-description    # or feature/description
# ... make changes, test ...
git add -A && git commit -m "type: description"
git push origin fix/short-description
# Open PR against main on GitHub
```

### Commit Convention

- `fix:` — bug fixes
- `feat:` — new features
- `chore:` — maintenance, deps, config
- `docs:` — documentation only

### Branch Naming

- `fix/short-description` for bug fixes
- `feature/short-description` for new features
- `chore/short-description` for maintenance

### Testing Locally

```bash
# Run the full pipeline (dry run)
npm run daily:dry

# Test scraper output
npm run test:scrape

# Check server health
curl http://localhost:3000/api/health
```

## License

ISC
