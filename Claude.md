# SLAM Backend - Cloudflare Workers API

**Version:** 1.0.0
**Framework:** Hono + Cloudflare Workers
**Language:** TypeScript
**Deployment:** Wrangler CLI

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Development](#development)
5. [Deployment](#deployment)
6. [API Endpoints](#api-endpoints)
7. [Environment Configuration](#environment-configuration)
8. [Migration Status](#migration-status)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Prerequisites
```bash
- Node.js 18+ (LTS)
- npm or pnpm
- Cloudflare account
- Wrangler CLI
```

### Installation

```bash
cd backend
npm install

# Login to Cloudflare
npx wrangler login

# Start development server
npm run dev
```

The API will be available at `http://localhost:8787`

---

## 🏗️ Architecture

### Technology Stack

- **Runtime:** Cloudflare Workers (V8 isolates)
- **Framework:** [Hono](https://hono.dev/) - Ultra-fast web framework
- **Language:** TypeScript with strict type checking
- **Deployment:** Wrangler 3.x
- **CI/CD:** GitHub Actions (planned)

### Why Cloudflare Workers?

- ⚡ **Fast:** Edge deployment in 300+ locations worldwide
- 💰 **Cost-effective:** 100,000 requests/day on free tier
- 🔒 **Secure:** Isolated V8 execution environment
- 🌍 **Global:** Automatic geo-distribution
- 📈 **Scalable:** Auto-scales to handle any load

### Why Hono?

- 🚀 **Ultra-fast:** 3.5x faster than Express
- 🪶 **Lightweight:** Only 14kB
- 🔧 **TypeScript-first:** Full type safety
- 🎯 **Workers-optimized:** Built for edge computing
- 🛠️ **Batteries included:** CORS, logger, validation

---

## 📁 Project Structure

```
backend/
├── src/
│   ├── index.ts              # Main Worker entry point with Hono router
│   ├── types.ts              # Shared TypeScript types
│   ├── api/                  # API endpoint handlers
│   │   ├── generate-questions.ts
│   │   ├── evaluate-answer.ts
│   │   ├── update-auto-mode.ts
│   │   ├── custom-hint.ts
│   │   ├── generate-geogebra.ts
│   │   ├── generate-mini-app.ts
│   │   ├── manage-learning-plan.ts
│   │   ├── manage-memories.ts
│   │   └── analyze-image.ts
│   └── utils/                # Utility functions
│       └── cors.ts
├── wrangler.toml            # Wrangler configuration
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript configuration
└── Claude.md                # This file

Original functions/ (to be migrated):
functions/
└── api/                     # Original Cloudflare Pages Functions (JavaScript)
    ├── generate-questions.js      (452 lines) ⚠️ Needs migration
    ├── evaluate-answer.js         (623 lines) ⚠️ Needs migration
    └── [other endpoints].js       ⚠️ Needs migration
```

---

## 🛠️ Development

### Commands

```bash
# Install dependencies
npm install

# Start development server (hot reload)
npm run dev

# Type check
npm run type-check

# Format code
npm run format

# Lint code
npm run lint

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production
```

### Local Development

```bash
# Start local server
npm run dev

# Server runs at http://localhost:8787

# Test health endpoint
curl http://localhost:8787/

# Test API endpoint
curl -X POST http://localhost:8787/api/generate-questions \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "test-key",
    "userId": "test-user",
    "topics": [],
    "userContext": {"gradeLevel": "11", "courseType": "Leistungskurs"}
  }'
```

### Hot Reload

Wrangler watches for file changes and automatically reloads the Worker.

---

## 🚀 Deployment

### Environments

The backend supports three environments:

1. **Development** (`npm run dev`)
   - Local testing
   - URL: `http://localhost:8787`

2. **Staging** (`npm run deploy:staging`)
   - Pre-production testing
   - URL: `https://api-staging.learn-smart.app`

3. **Production** (`npm run deploy:production`)
   - Live API
   - URL: `https://api.learn-smart.app`

### Prerequisites

1. **Cloudflare Account**
   - Sign up at https://dash.cloudflare.com

2. **Domain Setup**
   - Add `learn-smart.app` to Cloudflare
   - DNS records will be automatically configured by Workers Routes

3. **Wrangler Authentication**
   ```bash
   npx wrangler login
   ```

### Deploy to Staging

```bash
npm run deploy:staging
```

This deploys to `https://api-staging.learn-smart.app`

### Deploy to Production

```bash
npm run deploy:production
```

This deploys to `https://api.learn-smart.app`

### Verify Deployment

```bash
# Check health
curl https://api.learn-smart.app/

# Expected response:
{
  "service": "SLAM Backend API",
  "version": "1.0.0",
  "environment": "production",
  "status": "healthy",
  "timestamp": "2026-02-08T...",
  "endpoints": [...]
}
```

---

## 🔌 API Endpoints

### Health Check

```
GET /
```

Returns service information and available endpoints.

### Question Generation

```
POST /api/generate-questions
```

**Request:**
```json
{
  "apiKey": "claude-api-key",
  "userId": "user-id",
  "learningPlanItemId": 123,
  "topics": [
    {
      "leitidee": "Algebra",
      "thema": "Gleichungen",
      "unterthema": "Lineare Gleichungen"
    }
  ],
  "userContext": {
    "gradeLevel": "11",
    "courseType": "Leistungskurs"
  },
  "provider": "claude",
  "selectedModel": "claude-sonnet-4-5-20250929",
  "questionCount": 5,
  "afbLevel": "II"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session_1234567890_abc",
  "questions": [...],
  "totalQuestions": 5,
  "fromCache": false,
  "modelUsed": "claude-sonnet-4-5-20250929",
  "providerUsed": "claude"
}
```

### Answer Evaluation

```
POST /api/evaluate-answer
```

**Request:**
```json
{
  "questionId": "q_123",
  "userAnswer": "4",
  "correctAnswer": "4",
  "questionType": "step-by-step",
  "difficulty": 5,
  "hintsUsed": 1,
  "timeSpent": 45,
  "correctStreak": 3
}
```

**Response:**
```json
{
  "success": true,
  "isCorrect": true,
  "feedback": "Correct! Well done.",
  "xpEarned": 21,
  "detailedExplanation": "...",
  "nextDifficulty": 6
}
```

### Other Endpoints

- `POST /api/update-auto-mode` - Update AUTO mode parameters
- `POST /api/custom-hint` - Get personalized hints
- `POST /api/generate-geogebra` - Generate GeoGebra visualizations
- `POST /api/generate-mini-app` - Generate interactive mini-apps
- `POST /api/manage-learning-plan` - Learning plan operations
- `POST /api/manage-memories` - Spaced repetition management
- `POST /api/analyze-image` - Image upload and analysis

---

## ⚙️ Environment Configuration

### Secrets Management

Sensitive values (API keys) should be stored as Wrangler secrets:

```bash
# Set Claude API key
npx wrangler secret put CLAUDE_API_KEY

# Set Gemini API key
npx wrangler secret put GEMINI_API_KEY

# Set Firebase Service Account (JSON)
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

### Environment Variables

Non-sensitive configuration is in `wrangler.toml`:

```toml
[env.production]
vars = { ENVIRONMENT = "production" }

[env.staging]
vars = { ENVIRONMENT = "staging" }
```

### Accessing in Code

```typescript
import type { Env } from './index';

export async function handler(c: Context<{ Bindings: Env }>) {
  const apiKey = c.env.CLAUDE_API_KEY;
  const environment = c.env.ENVIRONMENT;
}
```

---

## 🔄 Migration Status

### ✅ Completed

- [x] Backend folder structure
- [x] TypeScript configuration
- [x] Wrangler setup with 3 environments
- [x] Hono framework integration
- [x] CORS configuration
- [x] Type definitions
- [x] API route stubs
- [x] Health check endpoint
- [x] Error handling

### ⚠️ In Progress

The original JavaScript functions need to be migrated to TypeScript:

| Endpoint | Original | Status | Lines |
|----------|----------|--------|-------|
| generate-questions | functions/api/generate-questions.js | 🔄 Stub | 452 |
| evaluate-answer | functions/api/evaluate-answer.js | 🔄 Stub | 623 |
| update-auto-mode | functions/api/update-auto-mode.js | 🔄 Stub | ~200 |
| custom-hint | functions/api/generate-custom-hint.js | 🔄 Stub | ~150 |
| generate-geogebra | functions/api/generate-geogebra.js | 🔄 Stub | ~180 |
| generate-mini-app | functions/api/generate-mini-app.js | 🔄 Stub | ~200 |
| manage-learning-plan | functions/api/manage-learning-plan.js | 🔄 Stub | ~150 |
| manage-memories | functions/api/manage-memories.js | 🔄 Stub | ~180 |
| analyze-image | functions/api/analyze-image.js | 🔄 Stub | ~120 |

**Total:** ~2,255 lines to migrate

### Migration Guide

To migrate an endpoint:

1. **Read original JavaScript**
   ```bash
   cat ../functions/api/generate-questions.js
   ```

2. **Copy logic to TypeScript**
   - Add types for request/response
   - Use Hono Context instead of Cloudflare Pages context
   - Convert callbacks to async/await
   - Add error handling

3. **Update handler**
   ```typescript
   export async function handleGenerateQuestions(c: Context<{ Bindings: Env }>) {
     const body = await c.req.json();
     // ... implement logic ...
     return c.json(response);
   }
   ```

4. **Test locally**
   ```bash
   npm run dev
   curl -X POST http://localhost:8787/api/generate-questions -d '{...}'
   ```

5. **Deploy to staging**
   ```bash
   npm run deploy:staging
   ```

---

## 🧪 Testing

### Manual Testing

```bash
# Health check
curl https://api.learn-smart.app/

# Test generate-questions
curl -X POST https://api.learn-smart.app/api/generate-questions \
  -H "Content-Type: application/json" \
  -d @test-request.json
```

### Automated Testing (Planned)

```bash
npm test
```

Uses Vitest for unit and integration tests.

---

## 🐛 Troubleshooting

### Common Issues

**1. "Command not found: wrangler"**
```bash
npm install -g wrangler
# or
npx wrangler
```

**2. "Not authenticated"**
```bash
npx wrangler login
```

**3. "Zone not found"**
- Ensure `learn-smart.app` is added to your Cloudflare account
- Update `zone_name` in `wrangler.toml`

**4. "CORS errors in browser"**
- Check origin is allowed in `src/index.ts` cors middleware
- Verify preflight OPTIONS requests are handled

**5. "Module not found"**
```bash
npm install
npm run dev
```

### Logs

View Worker logs:
```bash
npx wrangler tail --env production
```

### Debug Mode

Enable verbose logging in development:
```typescript
console.log('[endpoint] Debug info:', data);
```

---

## 📝 Development Workflow

### Feature Development

1. **Create feature branch**
   ```bash
   git checkout -b feature/new-endpoint
   ```

2. **Develop locally**
   ```bash
   npm run dev
   # Test changes at http://localhost:8787
   ```

3. **Type check**
   ```bash
   npm run type-check
   ```

4. **Deploy to staging**
   ```bash
   npm run deploy:staging
   # Test at https://api-staging.learn-smart.app
   ```

5. **Create PR**
   ```bash
   git add .
   git commit -m "feat: add new endpoint"
   git push origin feature/new-endpoint
   ```

6. **Deploy to production** (after PR approval)
   ```bash
   npm run deploy:production
   ```

---

## 🤖 Working with Claude Code

### Effective Prompts

**Good:**
```
"Migrate the evaluate-answer endpoint from functions/api/evaluate-answer.js
to backend/src/api/evaluate-answer.ts. Use the same logic but convert to
TypeScript with Hono Context."
```

**Bad:**
```
"Fix the backend"
```

### Migration Tasks

Use Claude Code to help migrate endpoints:

1. **Read original function**
   ```
   "Read functions/api/generate-questions.js and explain the logic"
   ```

2. **Convert to TypeScript**
   ```
   "Convert this to TypeScript and update backend/src/api/generate-questions.ts"
   ```

3. **Add types**
   ```
   "Add proper TypeScript types to backend/src/types.ts for this endpoint"
   ```

4. **Test**
   ```
   "Write a test request for this endpoint and verify it works"
   ```

---

## 📚 Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Hono Documentation](https://hono.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

## 🔐 Security

### API Key Management

- Never commit API keys to git
- Use Wrangler secrets for sensitive data
- Rotate keys regularly
- Use different keys for staging/production

### CORS

- CORS is configured to allow requests from `learn-smart.app`
- Localhost is allowed for development
- Adjust `src/index.ts` for custom origins

### Rate Limiting

TODO: Add rate limiting using Cloudflare's built-in features

---

## 📈 Next Steps

1. **Complete endpoint migration** - Convert remaining 9 endpoints
2. **Add unit tests** - Use Vitest for testing
3. **Set up CI/CD** - GitHub Actions for automated deployment
4. **Add monitoring** - CloudFlare Analytics + custom logging
5. **Optimize caching** - Use KV for question cache
6. **Add rate limiting** - Prevent abuse

---

**Status:** 🟡 **In Development** - Core structure complete, endpoints need migration

**Last Updated:** February 8, 2026
