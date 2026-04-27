<div align="center">

# JobPilot

### The autonomous job hunting agent that actually does the work.

Scrape postings, find hiring managers, draft outreach, lookup emails, and auto-fill applications — all from one local dashboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Claude](https://img.shields.io/badge/AI-Claude_Sonnet_4.6-D97757?style=flat-square)](https://www.anthropic.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#contributing)

</div>

---

## What it does

JobPilot is a **self-hosted, AI-powered job search command center**. It runs locally and replaces the manual grind of job hunting with autonomous agents that:

- **Scrape job listings** from LinkedIn (via Apify) — scored, deduplicated, cached
- **Track hiring managers** posting on LinkedIn ("we're hiring AI engineers") in real time
- **Surface startup jobs** by Google-searching across Ashby, Greenhouse, Lever, and Dover for specific roles
- **Draft personalized outreach** using your resume context and the recipient's profile
- **Find work emails** via Hunter.io for any LinkedIn poster
- **Auto-fill job applications** end-to-end using a vision-capable browser agent ([browser-use](https://github.com/browser-use/browser-use))
- **Persist everything** to SQLite — three-tier caching (memory → DB → API) so you never burn credits twice

All wired together in a dark-mode, terminal-aesthetic React dashboard.

---

## Demo

> _Add screenshots / GIFs here:_
> - `docs/screens/radar.png` — Job radar tab with scored postings
> - `docs/screens/hiring.png` — Hiring posts with email lookup
> - `docs/screens/startups.png` — Startup role search across ATS platforms
> - `docs/screens/apply.png` — Browser-use auto-apply with confirm step

---

## Features

### Three discovery pipelines

| Pipeline | What it does | Source |
|---|---|---|
| **Radar** | LinkedIn job postings, scored against your skills + role + location, filtered by recency | Apify LinkedIn scraper |
| **Hiring posts** | Real LinkedIn posts from founders/managers actively hiring, with time filter (24h/3d/week/month) | Apify LinkedIn posts scraper |
| **Startup roles** | Direct search across `jobs.ashbyhq.com`, `boards.greenhouse.io`, `jobs.lever.co`, `dover.com/jobs` for specific roles (FDE, AI Engineer, Solutions Eng, etc.) | Apify Google search scraper |

### Outreach + apply

| Feature | Stack |
|---|---|
| Personalized cold email drafts | Claude Sonnet 4.6 via TokenRouter |
| Work email lookup from name + company | Hunter.io API |
| Send email via Gmail SMTP | `aiosmtplib` |
| Auto-fill applications (Ashby / Greenhouse / Lever / Workday / custom) | browser-use agent + Playwright |
| Application history + status tracking | SQLite |

### Smart caching

Three-tier cache for every scrape — never burns API credits twice:

```
L1: In-memory (60min) → L2: SQLite DB (6h) → L3: Apify / Hunter / Google
```

On page reload, all three panels (jobs, hiring posts, startup jobs) restore instantly from DB.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     React Dashboard (Vite)                   │
│   Radar • Hiring • Startups • Outreach • Resume • History    │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTP
┌──────────────────────────────┴───────────────────────────────┐
│                   FastAPI Backend (Python)                   │
├─────────────┬─────────────┬───────────────┬──────────────────┤
│ /api/jobs   │ /api/apply  │ /api/outreach │ /api/prefs       │
│  search     │  start      │  draft        │  history         │
│  cached     │  status     │  find-email   │  resume          │
│  hiring-    │  confirm    │               │                  │
│  posts      │  abort      │               │                  │
│  startup-   │             │               │                  │
│  roles      │             │               │                  │
└──────┬──────┴──────┬──────┴───────┬───────┴──────┬───────────┘
       │             │              │              │
   Apify API    browser-use     Claude /       SQLite (jobs,
   (LinkedIn,   + Playwright    Hunter.io      posts, prefs,
    Google)     (vision agent)  Gmail SMTP     history)
```

---

## Tech stack

**Backend**
- FastAPI · SQLAlchemy · SQLite
- [browser-use](https://github.com/browser-use/browser-use) · Playwright (auto-apply)
- Apify (LinkedIn + Google scraping)
- Claude Sonnet 4.6 via [TokenRouter](https://tokenrouter.com) (OpenAI-compatible)
- Hunter.io (email finder)
- Gmail SMTP (`aiosmtplib`)

**Frontend**
- React 18 · Vite
- Lucide icons
- Custom CSS design system (no Tailwind, no UI lib — pure CSS variables)

---

## Quick start

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/jobpilot.git
cd jobpilot

# Frontend
npm install

# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cd ..
```

### 2. Configure environment

Create `backend/.env`:

```bash
# Required
TOKENROUTER_API_KEY=sk-...           # https://tokenrouter.com (or use any OpenAI-compatible Claude key)
TOKENROUTER_BASE_URL=https://api.tokenrouter.com/v1
APIFY_API_TOKEN=apify_api_...        # https://apify.com (free tier works)

# Email outreach (optional)
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=...               # https://myaccount.google.com/apppasswords

# Email lookup (optional)
HUNTER_API_KEY=...                   # https://hunter.io

# Frontend URL (for CORS in production)
FRONTEND_URL=http://localhost:5173
ENV=development
```

### 3. Run

Two terminals:

```bash
# Terminal 1 — backend
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
npm run dev
```

Open `http://localhost:5173`. First launch prompts for Mission Config (role, skills, location, resume context). Hit **Launch Agent** and the pipelines start.

---

## How auto-apply works

When you click **Auto Apply** on any job card:

1. FastAPI spawns a `browser-use` Agent with the job URL + your candidate profile
2. The agent launches a visible Chromium window (headful, with stealth args)
3. Vision + DOM hybrid: Claude looks at screenshots and selects/types into form fields
4. Multi-page wizards handled automatically (clicks Next/Continue)
5. Stops just before submit — UI shows live screenshot
6. You review → Confirm → second agent clicks submit + verifies success
7. Result + screenshot stored in history

Works on: Ashby, Greenhouse, Lever, Workday, Dover, custom company career pages.

Doesn't work on: hard captchas, sites requiring login, file-upload-only forms.

---

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/jobs/search` | LinkedIn job search via Apify |
| `GET`  | `/api/jobs/cached` | Restore cached jobs from DB |
| `POST` | `/api/jobs/hiring-posts` | LinkedIn hiring posts scraper |
| `GET`  | `/api/jobs/hiring-posts/cached` | Restore from DB |
| `POST` | `/api/jobs/startup-roles` | Google search across ATS platforms |
| `GET`  | `/api/jobs/startup-roles/cached` | Restore from DB |
| `POST` | `/api/outreach/draft` | Generate cold email |
| `GET`  | `/api/outreach/find-email` | Hunter.io email lookup |
| `POST` | `/api/email/send` | Send via Gmail SMTP |
| `POST` | `/api/apply/start` | Begin auto-apply session |
| `GET`  | `/api/apply/status/{id}` | Poll status + screenshot |
| `POST` | `/api/apply/confirm` | Confirm submit |
| `POST` | `/api/apply/abort` | Abort session |
| `POST` | `/api/prefs` | Save user preferences |
| `GET`  | `/api/history/` | Application history |

---

## Roadmap

- [ ] PDF resume parser (auto-fill applications with real resume file upload)
- [ ] Greenhouse direct API path (skip browser entirely for `boards.greenhouse.io`)
- [ ] Per-company application templates
- [ ] LinkedIn DM outreach via direct integration
- [ ] Multi-user mode with auth
- [ ] Slack notifications for new high-match jobs
- [ ] Browser extension for one-click apply on any job board
- [ ] Workday-specific multi-step wizard handler
- [ ] Cover letter generator with company-specific tailoring

---

## Contributing

Contributions welcome. Easy starting points:

1. **Add a new ATS adapter** — see `backend/routers/apply.py`. Currently uses browser-use as a universal fallback. Specialized handlers for popular ATS platforms would be faster + more reliable.
2. **Add a new job board** — extend `_PLATFORM_MAP` in `backend/routers/jobs.py` with new domain patterns for the startup roles search.
3. **Improve the LLM prompts** — better field-mapping prompts in the auto-apply agent → higher fill success rates.
4. **Frontend polish** — design system is in `src/index.css` (CSS custom properties).

```bash
# Dev workflow
git checkout -b feat/your-feature
# ... make changes ...
npm run build      # frontend smoke test
cd backend && python3 -c "import ast; ast.parse(open('routers/apply.py').read())"  # syntax check
git commit -m "feat: your change"
gh pr create
```

---

## Cost estimate

For a typical day of active job hunting (10 searches, 20 outreach drafts, 3 auto-applies):

| Service | Usage | Cost |
|---|---|---|
| TokenRouter (Claude) | ~30 calls @ ~5k tokens | ~$0.50 |
| Apify (LinkedIn + Google scrapers) | ~10 actor runs | ~$0.20 (free tier covers most) |
| Hunter.io email finder | ~10 lookups | Free tier: 25/month |
| Gmail SMTP | unlimited | Free |
| **Total** | | **~$0.70/day** |

---

## Privacy & data

- Everything runs locally — no telemetry, no analytics
- All data stored in `backend/jobpilot.db` (SQLite, gitignored)
- API keys live in `backend/.env` (gitignored)
- Auto-apply browser runs visibly so you see exactly what it's doing
- Source is fully auditable — no obfuscation, no minified blobs

---

## FAQ

**Q: Will this get me banned from LinkedIn?**
LinkedIn scraping runs through Apify which uses rotating proxies and rate limits. JobPilot itself never logs into your LinkedIn account.

**Q: Does auto-apply work 100% of the time?**
No. Realistic success rate is 70-85% on Ashby/Greenhouse/Lever, lower on Workday and custom sites. Hard captchas and login walls will always break automation. The human-confirm step before submit catches most failures.

**Q: Can I use my own LLM provider?**
Yes — TokenRouter is OpenAI-compatible. Swap `TOKENROUTER_BASE_URL` to any OpenAI-compatible endpoint (OpenAI, OpenRouter, local Ollama, etc.). Update the model name in `backend/routers/outreach.py` and `apply.py`.

**Q: Why not just use Simplify / LazyApply / Sonara?**
Those are SaaS, charge $20-50/month, send your data to their servers, and lock you into their workflows. JobPilot is local-first, owns your data, and you control every prompt + integration.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Star this repo if JobPilot saves you time on your next job search.**

Built by [@kirandevihosur](https://github.com/kirandevihosur) · Powered by [Claude](https://anthropic.com), [browser-use](https://github.com/browser-use/browser-use), [Apify](https://apify.com), [Hunter.io](https://hunter.io)

</div>
