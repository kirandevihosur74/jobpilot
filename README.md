# 🚀 JobPilot — AI-Powered Job Hunting Agent

A single-pane command center that autonomously hunts, curates, and acts on job opportunities using Claude AI, MCP integrations, and real-time web search.

![JobPilot](https://img.shields.io/badge/AI-Claude_Sonnet_4-blue?style=flat-square)
![Deploy](https://img.shields.io/badge/Deploy-GitHub_Pages-green?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## What It Does

**Three autonomous pipelines feed into one dashboard:**

| Pipeline | What it does | Powered by |
|---|---|---|
| **Job Radar** | Scrapes fresh postings, scores relevance to your profile | Claude API + Web Search |
| **Signal Tracker** | Monitors LinkedIn/Twitter for hiring posts from founders & managers | Claude API + Web Search |
| **Outreach Engine** | Drafts personalized cold emails with one click | Claude API + Gmail MCP |

**Full workflow:** Search → Review → Draft → Send → Track — all without leaving the app.

## Tech Stack

- **Frontend:** React 18 + Vite + Tailwind CSS
- **AI Agent:** Claude Sonnet 4 API with tool use
- **Search:** Claude Web Search tool for real-time job discovery
- **Integrations:** Gmail MCP, Google Calendar MCP, Google Drive MCP
- **Icons:** Lucide React
- **Deploy:** GitHub Pages via GitHub Actions

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/jobpilot.git
cd jobpilot
npm install
```

### 2. Run Locally

```bash
npm run dev
```

Open `http://localhost:5173` — the app will prompt for your Anthropic API key on first load.

### 3. Get Your API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Paste it into JobPilot's setup screen
4. Your key is stored in `localStorage` only — never sent anywhere except Anthropic's API

### 4. Configure Your Agent

Enter your:
- **Target role** — e.g. "Senior Frontend Engineer"
- **Location** — e.g. "San Francisco, Remote"
- **Skills** — e.g. "React, TypeScript, Node.js"
- **Target companies** — optional, e.g. "Stripe, Vercel, Linear"
- **Resume context** — paste a bio or resume summary for personalized outreach

Hit **Launch Agent** and the pipelines start running.

## Deploy to GitHub Pages

### Automatic (recommended)

1. Push to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/jobpilot.git
   git push -u origin main
   ```

2. Enable GitHub Pages:
   - Go to **Settings → Pages**
   - Source: **GitHub Actions**
   - The included workflow (`.github/workflows/deploy.yml`) handles the rest

3. Your app will be live at `https://YOUR_USERNAME.github.io/jobpilot/`

### Manual

```bash
npm run build
# Upload the `dist/` folder to any static host
```

## MCP Integrations

JobPilot uses Model Context Protocol (MCP) servers to interact with Google services:

| Service | What it does | MCP Server |
|---|---|---|
| **Gmail** | Sends outreach emails directly | `gmailmcp.googleapis.com` |
| **Google Calendar** | Schedules follow-up reminders | `calendarmcp.googleapis.com` |
| **Google Drive** | Pulls resume for context | `drivemcp.googleapis.com` |

> **Note:** MCP integrations require the servers to be accessible. When running standalone, you may need to configure OAuth for Gmail/Calendar/Drive access. The app works fully without MCP — you can copy outreach messages to clipboard and send manually.

## Architecture

```
┌──────────────────────────────────┐
│       React Dashboard (UI)       │
├──────────────────────────────────┤
│     Claude API Agent (Brain)     │
│   Tool Use · Scoring · Drafting  │
├──────────┬──────────┬────────────┤
│ Job Radar│ Signal   │ Outreach   │
│          │ Tracker  │ Engine     │
├──────────┴──────────┴────────────┤
│ Web Search │ Gmail │ Calendar │  │
│            │  MCP  │   MCP    │  │
└────────────┴───────┴──────────┘
```

## Project Structure

```
jobpilot/
├── .github/workflows/
│   └── deploy.yml          # GitHub Pages CI/CD
├── public/
│   └── favicon.svg
├── src/
│   ├── App.jsx             # Main application component
│   ├── main.jsx            # React entry point
│   └── index.css           # Global styles + Tailwind
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── README.md
```

## API Usage & Costs

Each "Scan" operation makes 2 Claude API calls (one for jobs, one for signals) with web search enabled. Each outreach draft is 1 additional call. Typical session cost: ~$0.10-0.30 depending on usage.

## Privacy

- Your API key is stored in `localStorage` only
- No analytics, no tracking, no external services beyond Anthropic's API
- All data stays in your browser
- Source code is fully auditable

## License

MIT
