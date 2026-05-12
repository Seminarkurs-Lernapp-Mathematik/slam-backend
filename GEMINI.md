# SLAM Backend - GEMINI Context

This file provides instructional context for Gemini CLI interactions with the SLAM Backend project.

## 🚀 Project Overview

**SLAM Backend** is a high-performance API for the SLAM Learning App, built with **Hono** and **TypeScript**, and deployed as **Cloudflare Workers**. It serves as the intelligent backbone for student learning experiences and teacher dashboard analytics.

- **Primary Stack:** TypeScript, Hono, Cloudflare Workers.
- **AI Integration:** Multi-provider AI orchestration (Gemini, Claude, Mistral, OpenAI) for question generation, evaluation, and interactive content.
- **Database/Auth:** Firebase (Firestore) for data persistence and Firebase Auth for user management.
- **Core Domain:** Mathematics education for German Gymnasien (high schools), following the national curriculum (Leitideen, Themen, Unterthemen).

---

## 🏗️ Architecture & Core Components

### 1. API Routing (`src/index.ts`)
The application uses **Hono** for ultra-fast routing at the edge.
- **Public API:** `/api/*` (e.g., `generate-questions`, `evaluate-answer`, `analyze-image`).
- **Teacher API:** `/api/teacher/*` (requires `teacher` role in Firebase custom claims).
- **Middleware:** CORS is configured to allow specific domains and localhost. Rate limiting is applied to teacher routes.

### 2. AI Orchestration (`src/utils/callAI.ts` & `src/config/models.json`)
A centralized AI utility supports multiple providers.
- **Task-Based Configuration:** Model selection, temperature, and system prompts are defined per task in `src/config/models.json`.
- **Supported Providers:** Claude (Anthropic), Gemini (Google), OpenAI, Mistral, and OpenRouter.
- **Vision Support:** Dedicated `callVisionAI` helper for image-based tasks like `analyze-image`.

### 3. Data Persistence (`src/utils/firestore.ts`)
Since Cloudflare Workers run in a V8 isolate without the standard Node.js environment, the project uses a custom **Firestore REST API wrapper** to perform CRUD operations and structured queries.

### 4. Authentication (`src/utils/verifyTeacherToken.ts`)
Teacher routes are protected by a custom JWT verification middleware that validates Firebase ID tokens using the Web Crypto API against Google's public JWK keys.

---

## 🛠️ Building and Running

| Task | Command |
| :--- | :--- |
| **Development** | `npm run dev` (starts local Wrangler server with hot reload) |
| **Type Check** | `npm run type-check` (runs `tsc --noEmit`) |
| **Linting** | `npm run lint` (uses ESLint) |
| **Formatting** | `npm run format` (uses Prettier) |
| **Testing** | `npm run test` (uses Vitest) |
| **Staging Deploy** | `npm run deploy:staging` |
| **Production Deploy** | `npm run deploy:production` |

---

## 📏 Development Conventions

### 1. File Structure
- `src/api/`: Endpoint handlers. Each handler should be in its own file.
- `src/teacher/`: Domain logic and routes for the teacher dashboard.
- `src/utils/`: Shared utilities (AI, Firestore, Auth, Logger).
- `src/config/`: Static configuration files (e.g., `models.json`).

### 2. Coding Style
- **Strict TypeScript:** Maintain full type safety. Define interfaces for request/response payloads in `src/types.ts` or locally in handlers.
- **Error Handling:** Use the `APIError` class for consistent error responses.
- **Logging:** Use the structured `logger` from `src/utils/logger.ts` instead of raw `console.log`.
- **German Math Context:** Always use the established Leitideen (Algebra, Analysis, Geometrie, Stochastik) when dealing with curriculum mapping.

### 3. AI Task Updates
To change a model or prompt for an AI-powered feature, edit `src/config/models.json`. Do not hardcode prompts or model IDs in handler files.

### 4. Security
- **Secrets:** Never commit API keys or service account JSONs. Use `wrangler secret put <NAME>` for sensitive environment variables.
- **PII:** Be cautious when sending data to AI providers; utilize `src/utils/sanitizePII.ts` if necessary.

---

## 🔍 Key Files for Reference
- `src/index.ts`: Main entry point and route definitions.
- `src/config/models.json`: AI task configurations (The "Brain").
- `src/utils/callAI.ts`: Multi-provider AI implementation.
- `src/utils/firestore.ts`: Database access logic.
- `src/teacher/types.ts`: Domain models for teacher-student relationships.

---

**Status:** 🟡 Migration in progress (JavaScript to TypeScript). Follow `Claude.md` for specific migration guides.
