# 🇵🇰 PPRA IT-Tender Autonomous Sentinel (PITAS)

> **Live → [server.14.jugaar.ai/pitas](https://server.14.jugaar.ai/pitas)**

Automated daily alert system for IT-relevant government tenders from Pakistan's PPRA/EPADS procurement portals.

## What It Does

1. **Scrapes** active tenders from EPMS (primary) and EPADS v2.0 (secondary) twice daily
2. **Filters** using native portal sector filters + keyword matching + AI classification for edge cases
3. **Deduplicates** across sources and detects tender updates (amended deadlines, addenda)
4. **Emails** a daily digest of IT-relevant tenders to registered users

## 🔗 Links

| | |
|---|---|
| **Live App** | [server.14.jugaar.ai/pitas](https://server.14.jugaar.ai/pitas) |
| **Register** | [server.14.jugaar.ai/pitas](https://server.14.jugaar.ai/pitas) |
| **Health Check** | [server.14.jugaar.ai/pitas/api/health](https://server.14.jugaar.ai/pitas/api/health) |

## Architecture

```
[Cron: 7 AM + 3 PM PKT]
    → [fetch + cheerio scraper] (EPMS sector=14 + EPADS)
    → [keyword pre-filter] → [Groq/Llama-3 for ambiguous]
    → [dedup + update detection] → [SQLite]
    → [match user preferences] → [Gmail SMTP email digest]
```

## Tech Stack

- **Scraper:** `fetch` + `cheerio` (no Playwright needed — confirmed via Task 0 validation)
- **Scheduler:** Linux cron (twice daily)
- **AI:** Groq API + Llama-3 (only for ambiguous classification)
- **Database:** SQLite via `better-sqlite3`
- **Email:** Gmail SMTP via nodemailer (free, no domain verification needed)
- **Backend:** Node.js + Express
- **Frontend:** Single HTML file (registration + unsubscribe)
- **Deployment:** VPS `server.14.jugaar.ai`, PM2 + cron
- **Proxy:** Nginx reverse proxy at `/pitas`

## Quick Start

```bash
# Clone
git clone https://github.com/tahiralatif/PPRA-IT-Tender-Autonomous-Sentinel.git
cd PPRA-IT-Tender-Autonomous-Sentinel

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your Gmail App Password and Groq API key

# Run
node scripts/daily-run.js          # Full pipeline
node scripts/daily-run.js --dry-run # Preview without sending
```

## Project Status

- [x] **Task 0:** Data source validation — ✅ Complete
- [x] **Task 1:** Scraper module (EPMS + EPADS) — ✅ Complete
- [x] **Task 2:** Classification module — ✅ Complete
- [x] **Task 3:** Database + dedup + update detection — ✅ Complete
- [x] **Task 4:** API + frontend — ✅ Complete
- [x] **Task 5:** Emailer — ✅ Complete
- [x] **Task 6:** Orchestration — ✅ Complete
- [x] **Task 7:** Seed users + first live run — ✅ Complete
- [x] **Task 8:** Deploy + monitor — ✅ Complete
- [x] **Task 9:** Open public registration — ✅ Complete
- [x] **Task 10:** On-demand check feature — ✅ Complete (PR #1)

## Key Finding (Task 0)

Both EPMS and EPADS serve **server-side rendered HTML**. No Playwright/browser automation needed. EPMS has a working `sector=14` filter for "Info and Comm Tech" that does most of the classification work server-side.

→ See [`TASK-0-VALIDATION.md`](TASK-0-VALIDATION.md) for full details.

## License

ISC
