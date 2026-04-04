# Facebook Marketing app

Vite frontend + Node.js API for Meta Marketing API workflows (campaigns, creatives, targeting search, CAPI, CRM hooks).

## Requirements

- Node.js 22+
- Meta app with Marketing API permissions (for live mode)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — add META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (act_…), META_PAGE_ID, etc.
```

## Dev

```bash
# Terminal 1 — API (default http://localhost:3001)
npm run dev:api

# Terminal 2 — UI (default http://localhost:5173)
npm run dev
```

Or both: `npm run dev:all`

## Build

```bash
npm run build
npm run preview   # optional: preview production build
```

## Tests

```bash
npm test
```

## Security

- Never commit `.env` (gitignored). Copy from `.env.example` and fill secrets locally.
- Rotate Meta tokens if they were ever exposed.
