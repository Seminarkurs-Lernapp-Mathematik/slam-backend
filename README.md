# SLAM Backend - Cloudflare Workers

Ultra-fast API backend built with Hono and TypeScript, deployed to Cloudflare Workers edge network.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Deploy to production
npm run deploy:production
```

---

## 📚 Documentation

See **[Claude.md](./Claude.md)** for complete documentation including:
- Architecture overview
- API endpoints reference
- Development workflow
- Deployment instructions
- Migration guide
- Troubleshooting

---

## 🏗️ Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono (ultra-fast, lightweight)
- **Language:** TypeScript
- **Deployment:** Wrangler CLI

---

## 📁 Structure

```
backend/
├── src/
│   ├── index.ts              # Main Worker entry
│   ├── types.ts              # Type definitions
│   ├── api/                  # Endpoint handlers
│   └── utils/                # Utilities
├── wrangler.toml             # Config (3 environments)
├── package.json
├── tsconfig.json
└── Claude.md                 # Full documentation
```

---

## 🌐 Environments

- **Development:** `npm run dev` → http://localhost:8787
- **Staging:** `npm run deploy:staging` → https://api-staging.learn-smart.app
- **Production:** `npm run deploy:production` → https://api.learn-smart.app

---

## ⚡ Features

- ✅ Ultra-fast edge deployment (300+ locations)
- ✅ TypeScript with full type safety
- ✅ CORS configured for Flutter Web
- ✅ Multiple environments (dev/staging/prod)
- ✅ Hot reload in development
- ⚠️ API endpoints need migration from JavaScript

---

## 🔄 Migration Status

Backend structure is complete. API endpoint implementations need migration from `../functions/api/*.js` to `src/api/*.ts`.

See migration guide in Claude.md or ../MIGRATION_SUMMARY.md

---

## 📝 Commands

```bash
npm run dev                   # Start local server
npm run deploy                # Deploy to default env
npm run deploy:staging        # Deploy to staging
npm run deploy:production     # Deploy to production
npm run type-check            # TypeScript check
npm run format                # Format code
```

---

## 🤖 Need Help?

Open `Claude.md` in Claude Code and ask:
- "Explain the backend architecture"
- "How do I migrate an endpoint?"
- "Show me how to test the API"

---

**Status:** 🟡 Structure Complete - Endpoints Pending Migration
