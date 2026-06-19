# RobinHood AI Trader

Autonomous AI trading bot powered by Robinhood's official MCP server and your choice of LLM (Claude, GPT-4, Gemini, Groq, and more). Self-host anywhere with Docker Compose in one command.

---

## Features

- **Fully autonomous** — AI reads market data, news, and portfolio state, then decides what to trade
- **Any LLM** — bring your own API key for Anthropic, OpenAI, Google, Groq, Mistral, or any LiteLLM-supported provider
- **Robinhood MCP** — official `https://agent.robinhood.com/mcp/trading` integration via OAuth
- **Strategy editor** — choose from built-in templates (Momentum, News Sentiment, Value) or write your own
- **Scan frequency control** — every 5 min, 15 min, 30 min, hourly, daily, or custom cron
- **Dry-run by default** — agent describes trades without executing until you explicitly enable live trading
- **Web dashboard** — portfolio overview, live agent log, trade history with AI reasoning
- **One-command deploy** — Docker Compose, works on any VPS, Railway, Render, Fly.io, or local machine

---

## Quick Start

### 1. Clone and configure

```bash
git clone <repo-url>
cd robinhood-ai-trader
cp .env.example .env
```

Edit `.env`:
```env
TRADING_ENABLED=false        # keep false until you've tested!
SECRET_KEY=<strong-random-string>

# Base URL for the OAuth callback (your-domain.com for cloud, http://localhost for local)
CALLBACK_BASE_URL=http://localhost
```

> No Robinhood developer credentials needed. Authentication uses the same MCP OAuth flow as `claude mcp add robinhood-trading` — just click "Connect Robinhood" in the UI.

### 2. Start

```bash
docker compose up -d
```

### 3. Configure via the UI

Visit `http://localhost`

1. **Settings → AI Model** — add your API key (Anthropic, OpenAI, etc.) and click "Set Active"
2. **Settings → Robinhood Connection** — click "Connect Robinhood" and complete the OAuth flow
3. **Strategies** — pick a built-in strategy and click "Enable", or create a custom one
4. The agent will start running on the strategy's schedule automatically

---

## Enabling Live Trading

The agent runs in **dry-run mode by default** — it analyzes markets and explains what it would do, but doesn't place real orders.

When you're ready to go live:
```env
# .env
TRADING_ENABLED=true
```
Then restart: `docker compose restart backend`

---

## Strategies

### Built-in Templates

| Strategy | Frequency | Description |
|---|---|---|
| **Momentum Trader** | Every 30 min | Rides price momentum, sells reversals |
| **News Sentiment** | Every 15 min | Buys on positive news catalysts |
| **Value Investor** | Daily at open | Identifies undervalued stocks |
| **Custom Template** | 60 min | Your own logic — edit freely |

### Creating a Custom Strategy

Go to **Strategies → New Strategy** and fill in:
- **Scan Frequency** — how often the AI wakes up (5 min → daily)
- **Watchlist** — specific tickers, or leave blank to let the AI choose
- **Max Position Size** — % of portfolio per trade
- **AI Trading Instructions** — describe your strategy in plain English

---

## Supported LLM Providers

| Provider | Example Model |
|---|---|
| Anthropic | `claude-opus-4-8` (recommended) |
| OpenAI | `gpt-4o` |
| Google | `gemini-2.0-flash` |
| Groq | `llama-3.3-70b-versatile` |
| Mistral | `mistral-large-latest` |
| Any LiteLLM-supported | custom model string |

---

## Safety

- **Dry-run by default** — `TRADING_ENABLED=false` in `.env`
- **Kill switch** — stop the scheduler instantly from the sidebar
- **Position size limits** — per-strategy, default 5% of portfolio
- **Daily trade cap** — configurable per strategy
- **Audit log** — every AI decision logged with full reasoning
- **Encrypted storage** — API keys and OAuth tokens encrypted at rest with your `SECRET_KEY`

---

## Deployment

Works on any host with Docker:

```bash
# Railway / Render / Fly.io — push the repo and set env vars in their dashboard
# VPS
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Local dev
docker compose up
```

For HTTPS, add your TLS certificates to `nginx/certs/` and update `docker-compose.prod.yml`.

---

## Architecture

```
nginx → /api  → FastAPI backend
     → /ws   → WebSocket (live agent events)
     → /auth → Robinhood OAuth
     → /     → React SPA

Backend:
  APScheduler → agent/runner.py → LiteLLM → MCP → Robinhood
  SQLite (trade log, runs, configs, tokens)
```
