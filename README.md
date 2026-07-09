# 🇵🇰 PPRA IT-Tender Autonomous Sentinel (PITAS)

Automated daily alert system for IT-relevant government tenders from Pakistan's PPRA/EPADS procurement portals.

## What It Does

1. **Scrapes** active tenders from EPMS (primary) and EPADS v2.0 (secondary) twice daily
2. **Filters** using native portal sector filters + keyword matching + AI classification for edge cases
3. **Deduplicates** across sources and detects tender updates (amended deadlines, addenda)
4. **Emails** a daily digest of IT-relevant tenders to registered users

## Architecture

```
[Cron: 7 AM + 3 PM PKT]
    → [fetch + cheerio scraper] (EPMS sector=14 + EPADS)
    → [keyword pre-filter] → [Groq/Llama-3 for ambiguous]
    → [dedup + update detection] → [SQLite]
    → [match user preferences] → [Resend email digest]
```

## Tech Stack

- **Scraper:** `fetch` + `cheerio` (no Playwright needed — confirmed via Task 0 validation)
- **Scheduler:** Linux cron (twice daily)
- **AI:** Groq API + Llama-3 (only for ambiguous classification)
- **Database:** SQLite via `better-sqlite3`
- **Email:** Resend (free tier: 100/day)
- **Backend:** Node.js + Express
- **Frontend:** Single HTML file (registration + unsubscribe)
- **Deployment:** VPS `server.14.jugaar.ai`, PM2 + cron

## Project Status

- [x] **Task 0:** Data source validation — ✅ Complete
- [x] **Task 1:** Scraper module (EPMS + EPADS) — ✅ Complete
- [ ] **Task 2:** Scraper module (add EPMS)
- [x] **Task 3:** Classification module — ✅ Complete
- [ ] **Task 4:** Database + dedup + update detection
- [ ] **Task 5:** API + frontend
- [ ] **Task 6:** Emailer
- [ ] **Task 7:** Orchestration script
- [ ] **Task 8:** Seed users + first live run
- [ ] **Task 9:** Deploy + monitor
- [ ] **Task 10:** Open public registration

## Key Finding (Task 0)

Both EPMS and EPADS serve **server-side rendered HTML**. No Playwright/browser automation needed. EPMS has a working `sector=14` filter for "Info and Comm Tech" that does most of the classification work server-side.

→ See [`TASK-0-VALIDATION.md`](TASK-0-VALIDATION.md) for full details.

## License

ISC
