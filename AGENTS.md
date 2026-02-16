# SLAM Backend - Agent Guide

**Project:** SLAM Learning App Backend  
**Type:** Cloudflare Workers API (TypeScript/Hono)  
**Deployment:** https://api.learn-smart.app  
**Last Updated:** February 2026

---

## Project Overview

Ultra-fast edge API for the SLAM Flutter app. Handles AI question generation, answer evaluation, adaptive learning, and gamification logic.

### Key Features

- **Edge Deployment:** 300+ Cloudflare locations worldwide
- **AI Integration:** Claude (Anthropic) & Gemini (Google) support
- **Smart Caching:** Firestore-based question cache (7-day TTL)
- **Math Engine:** Semantic equivalence checking (x+1 = 1+x, 1/2 = 0.5)
- **Misconception Detection:** 7 common error patterns identified

---

## Technology Stack

- **Runtime:** Cloudflare Workers (V8 isolates)
- **Framework:** Hono 4.x (ultra-fast, 14kB)
- **Language:** TypeScript 5.3+
- **Deployment:** Wrangler CLI 3.x
- **Testing:** Vitest (planned)

---

## Project Structure

```
slam-backend/
├── src/
│   ├── index.ts              # Main Hono router, CORS, error handling
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── api/                  # Endpoint handlers
│   │   ├── generate-questions.ts    ✅ Migrated (757 lines)
│   │   ├── evaluate-answer.ts       ✅ Migrated (796 lines)
│   │   ├── custom-hint.ts           ✅ Migrated (274 lines)
│   │   ├── get-models.ts            ✅ Migrated
│   │   ├── generate-geogebra.ts     🔄 Stub (needs migration)
│   │   ├── generate-mini-app.ts     🔄 Stub (needs migration)
│   │   ├── update-auto-mode.ts      🔄 Stub (needs migration)
│   │   ├── manage-learning-plan.ts  🔄 Stub (needs migration)
│   │   ├── manage-memories.ts       🔄 Stub (needs migration)
│   │   └── analyze-image.ts         🔄 Stub (needs migration)
│   └── utils/
│       └── cors.ts           # CORS header utilities
├── wrangler.toml             # 3 environment configs
├── package.json
└── tsconfig.json
```

---

## API Endpoints Status

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/` | GET | ✅ | Health check with endpoint list |
| `/api/generate-questions` | POST | ✅ | AI question generation with caching |
| `/api/evaluate-answer` | POST | ✅ | Answer evaluation with XP calculation |
| `/api/custom-hint` | POST | ✅ | Progressive AI hints |
| `/api/get-models` | GET | ✅ | List available AI models |
| `/api/generate-geogebra` | POST | 🔄 | GeoGebra command generation (stub) |
| `/api/generate-mini-app` | POST | 🔄 | KI-Labor app generation (stub) |
| `/api/update-auto-mode` | POST | 🔄 | Adaptive difficulty (stub) |
| `/api/manage-learning-plan` | POST | 🔄 | Learning plan CRUD (stub) |
| `/api/manage-memories` | POST | 🔄 | Spaced repetition (stub) |
| `/api/analyze-image` | POST | 🔄 | Image analysis for topics (stub) |
| `/api/purchase` | POST | ❌ | Server-side purchase validation (not created) |

**Legend:** ✅ Complete | 🔄 Stub/Partial | ❌ Not Started

---

## Environment Configuration

### Development
```bash
npm run dev                 # localhost:8787
```

### Staging
```bash
npm run deploy:staging      # https://api-staging.learn-smart.app
```

### Production
```bash
npm run deploy:production   # https://api.learn-smart.app
```

### Secrets (set via Wrangler)
```bash
npx wrangler secret put CLAUDE_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

---

## Key Implementation Details

### Model Router (`generate-questions.ts`)

Auto-selects AI model based on complexity:
- **Light:** Claude Haiku / Gemini Flash (simple queries, AFB I)
- **Standard:** Claude Sonnet / Gemini Flash (normal questions)
- **Heavy:** Claude Sonnet / Gemini Pro (complex proofs, AFB III, GeoGebra)

### Question Cache

- **Storage:** Firestore `question_cache` collection
- **Key:** `cache_{topics_hash}_AFB{level}_D{difficulty}`
- **TTL:** 7 days
- **Format:** Array of JSON-serialized questions

### Math Equivalence Engine (`evaluate-answer.ts`)

Three-tier checking:
1. **Exact:** Normalized string match
2. **Numeric:** Evaluates to same value (1/2 = 0.5)
3. **Algebraic:** Term-by-term comparison (x+1 = 1+x)

### Misconception Detection

7 patterns detected:
1. Sign error (+/- confusion)
2. Factor forgotten
3. Fraction flipped (reciprocal)
4. Order of operations
5. Power error (square vs root)
6. Decimal/comma placement
7. Unit conversion error

---

## Code Style

### Handler Pattern
```typescript
export async function handleEndpoint(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<RequestType>();
    // ... validate, process ...
    return c.json({ success: true, data });
  } catch (error) {
    if (error instanceof APIError) {
      return c.json({ success: false, error: error.message }, error.statusCode);
    }
    return c.json({ success: false, error: 'Internal error' }, 500);
  }
}
```

### AI Provider Calls
```typescript
// Use callAIProvider() helper from generate-questions.ts
const response = await callAIProvider({
  provider: 'claude',  // or 'gemini'
  apiKey,
  model,
  prompt,
  temperature: 0.7,
  maxTokens: 4000,
});
```

---

## Migration Guide

To migrate a stub endpoint:

1. **Read original JS:** Check `../functions/api/[endpoint].js`
2. **Copy to TypeScript:** Add types, use async/await
3. **Use Hono Context:** Replace `context.request` with `c.req`
4. **Test locally:** `npm run dev`
5. **Deploy to staging:** `npm run deploy:staging`
6. **Verify:** Test with Flutter app

---

## Current Status

**Overall:** 🟡 **65% Complete**
- Core infrastructure: ✅ 100%
- Critical endpoints: ✅ 100% (generate, evaluate, hint)
- Secondary endpoints: 🔄 0% (4 stubs)
- Purchase validation: ❌ 0% (not created)

**Next Priority:** Migrate `generate-mini-app.ts` for KI-Labor feature

---

## Troubleshooting

### Build Issues
```bash
npm run type-check    # Check TypeScript
npm run dev           # Test locally
```

### Deployment Issues
```bash
npx wrangler login    # Re-authenticate
npx wrangler tail     # View logs
```

### CORS Errors
- Check origin in `src/index.ts` CORS middleware
- Ensure `learn-smart.app` is in allowed origins

---

**Happy Coding! 🚀**
