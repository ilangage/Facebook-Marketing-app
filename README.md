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

## Push to GitHub

If this repo is not linked yet, add your **GitHub username** and remote, then push:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/Facebook-Marketing-app.git
git branch -M main
git push -u origin main
```

If `origin` already exists with a wrong URL:

```bash
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/Facebook-Marketing-app.git
git push -u origin main
```

Use a [Personal Access Token](https://github.com/settings/tokens) as the password when Git asks (HTTPS), or use SSH: `git@github.com:YOUR_USERNAME/Facebook-Marketing-app.git`.
