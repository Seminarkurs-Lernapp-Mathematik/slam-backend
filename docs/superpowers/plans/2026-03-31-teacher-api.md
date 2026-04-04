# Teacher Dashboard API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all `/api/teacher/*` REST endpoints to slam-backend so the Teacher Dashboard frontend can authenticate, manage classes, view student analytics, and generate AI assessments.

**Architecture:** All teacher routes live under `/api/teacher/*` and are protected by a single `requireTeacher` Hono middleware that verifies Firebase ID tokens and checks for the `role: "teacher"` custom claim. Routes are split into focused router files (`me.ts`, `classes.ts`, `analytics.ts`, `goals.ts`, `students.ts`) mounted on the main Hono app. Firestore is accessed via a shared REST helper module (`firestore.ts`) that converts between plain JS objects and the Firestore wire format.

**Tech Stack:** Hono 4 (Cloudflare Workers), Vitest, Firebase Identity Platform (ID token verification via Google JWK), Firestore REST API, Anthropic Claude (AI assessment via existing `callAI` util).

---

## File Structure

```
slam-backend/
├── vitest.config.ts                           NEW — test runner config
├── src/
│   ├── index.ts                               MODIFY — add Variables type + teacher routes
│   ├── utils/
│   │   ├── firebaseAuth.ts                    existing — unchanged
│   │   ├── firestore.ts                       NEW — Firestore REST helpers
│   │   ├── verifyTeacherToken.ts              NEW — Firebase ID token verification + middleware
│   │   ├── firestore.test.ts                  NEW
│   │   └── verifyTeacherToken.test.ts         NEW
│   └── teacher/
│       ├── types.ts                           NEW — teacher domain interfaces
│       ├── me.ts                              NEW — GET/PUT /api/teacher/me
│       ├── classes.ts                         NEW — class CRUD + student membership
│       ├── analytics.ts                       NEW — class analytics + feed
│       ├── goals.ts                           NEW — class learning goals
│       ├── students.ts                        NEW — AI assessment, invite, reset-password
│       ├── me.test.ts                         NEW
│       ├── classes.test.ts                    NEW
│       ├── analytics.test.ts                  NEW
│       ├── goals.test.ts                      NEW
│       └── students.test.ts                   NEW
```

**Routing strategy** — all `/class` subrouters are mounted at the same prefix; Hono tries them in order:
```typescript
app.use('/api/teacher/*', requireTeacher)
app.route('/api/teacher/me', meRouter)
app.route('/api/teacher/class', classesRouter)    // CRUD + membership
app.route('/api/teacher/class', analyticsRouter)  // analytics + feed
app.route('/api/teacher/class', goalsRouter)      // goals
app.route('/api/teacher/student', studentsRouter) // AI assessment, invite, reset
```

**Key pattern** — every router file exports a default Hono router typed with the shared `AppEnv`:
```typescript
import type { Env } from '../index'
type AppEnv = { Bindings: Env; Variables: { teacherUid: string } }
const router = new Hono<AppEnv>()
export default router
```

---

## Task 1: Test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/teacher/setup.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
```

- [ ] **Step 2: Create smoke test**

```typescript
// src/teacher/setup.test.ts
import { describe, it, expect } from 'vitest'

describe('test runner', () => {
  it('works', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Run tests to verify the runner works**

```bash
cd C:/Users/marco/dev/Seminarkurs/slam-backend
npm test
```

Expected output: `1 passed`

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts src/teacher/setup.test.ts
git commit -m "chore: set up vitest test infrastructure"
```

---

## Task 2: Firestore REST helpers

**Files:**
- Create: `src/utils/firestore.ts`
- Create: `src/utils/firestore.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/utils/firestore.test.ts
import { describe, it, expect } from 'vitest'
import { toFsFields, fromFsDoc, fromFsValue } from './firestore'

describe('toFsFields', () => {
  it('converts string values', () => {
    expect(toFsFields({ name: 'Anna' })).toEqual({
      name: { stringValue: 'Anna' },
    })
  })

  it('converts integer values', () => {
    expect(toFsFields({ count: 5 })).toEqual({
      count: { integerValue: '5' },
    })
  })

  it('converts boolean values', () => {
    expect(toFsFields({ active: true })).toEqual({
      active: { booleanValue: true },
    })
  })

  it('converts null values', () => {
    expect(toFsFields({ x: null })).toEqual({
      x: { nullValue: null },
    })
  })

  it('converts arrays', () => {
    expect(toFsFields({ ids: ['a', 'b'] })).toEqual({
      ids: {
        arrayValue: {
          values: [{ stringValue: 'a' }, { stringValue: 'b' }],
        },
      },
    })
  })

  it('converts nested objects', () => {
    expect(toFsFields({ grid: { rows: 4, cols: 5 } })).toEqual({
      grid: {
        mapValue: {
          fields: {
            rows: { integerValue: '4' },
            cols: { integerValue: '5' },
          },
        },
      },
    })
  })
})

describe('fromFsDoc', () => {
  it('extracts id from document name', () => {
    const doc = {
      name: 'projects/p/databases/(default)/documents/classes/abc123',
      fields: { name: { stringValue: '11a' } },
    }
    const result = fromFsDoc(doc)
    expect(result.id).toBe('abc123')
    expect(result.name).toBe('11a')
  })

  it('converts nested mapValue', () => {
    const doc = {
      name: 'projects/p/databases/(default)/documents/classes/x',
      fields: {
        gridConfig: {
          mapValue: {
            fields: {
              rows: { integerValue: '4' },
              cols: { integerValue: '5' },
            },
          },
        },
      },
    }
    const result = fromFsDoc(doc)
    expect(result.gridConfig).toEqual({ rows: 4, cols: 5 })
  })

  it('converts arrayValue', () => {
    const doc = {
      name: 'projects/p/databases/(default)/documents/classes/x',
      fields: {
        studentIds: {
          arrayValue: {
            values: [{ stringValue: 'uid1' }, { stringValue: 'uid2' }],
          },
        },
      },
    }
    const result = fromFsDoc(doc)
    expect(result.studentIds).toEqual(['uid1', 'uid2'])
  })
})

describe('fromFsValue', () => {
  it('handles empty arrayValue', () => {
    expect(fromFsValue({ arrayValue: {} })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- src/utils/firestore.test.ts
```

Expected: FAIL — `firestore.ts` not found.

- [ ] **Step 3: Write `src/utils/firestore.ts`**

```typescript
// src/utils/firestore.ts
/**
 * Thin helpers for Firestore REST API.
 * Converts between plain JS objects and Firestore wire format.
 */

type FsRawValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FsRawValue[] } }
  | { mapValue: { fields?: Record<string, FsRawValue> } };

type FsFields = Record<string, FsRawValue>;

const fsBase = (projectId: string) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

/** Read a single document. Returns null on 404. */
export async function fsGet(
  projectId: string,
  token: string,
  path: string
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${fsBase(projectId)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed: ${res.status}`);
  return fromFsDoc(await res.json() as { fields?: FsFields; name?: string });
}

/** Write (full replace) a document at the given path. */
export async function fsPatch(
  projectId: string,
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${fsBase(projectId)}/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFsFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path} failed: ${res.status}`);
  return fromFsDoc(await res.json() as { fields?: FsFields; name?: string });
}

/** Delete a document. */
export async function fsDelete(
  projectId: string,
  token: string,
  path: string
): Promise<void> {
  const res = await fetch(`${fsBase(projectId)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Firestore DELETE ${path} failed: ${res.status}`);
}

/**
 * Run a structured query.
 * @param parent - path relative to /documents, e.g. '' for top-level, 'users/uid123' for subcollection
 * @param query  - Firestore structuredQuery object (without the outer { structuredQuery: } wrapper)
 */
export async function fsQuery(
  projectId: string,
  token: string,
  parent: string,
  query: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const parentPath = parent
    ? `projects/${projectId}/databases/(default)/documents/${parent}`
    : `projects/${projectId}/databases/(default)/documents`;

  const res = await fetch(`${parentPath}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery: query }),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const rows = await res.json() as Array<{ document?: { fields?: FsFields; name?: string } }>;
  return rows.filter((r) => r.document).map((r) => fromFsDoc(r.document!));
}

// --- Serialization ---

export function toFsFields(obj: Record<string, unknown>): FsFields {
  const out: FsFields = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFsValue(v);
  }
  return out;
}

export function toFsValue(v: unknown): FsRawValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFsValue) } };
  }
  if (typeof v === 'object') {
    return { mapValue: { fields: toFsFields(v as Record<string, unknown>) } };
  }
  return { stringValue: String(v) };
}

export function fromFsDoc(doc: { fields?: FsFields; name?: string }): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (doc.name) result.id = doc.name.split('/').pop()!;
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    result[k] = fromFsValue(v);
  }
  return result;
}

export function fromFsValue(v: FsRawValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFsValue);
  if ('mapValue' in v) return fromFsDoc({ fields: v.mapValue.fields });
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/utils/firestore.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/firestore.ts src/utils/firestore.test.ts
git commit -m "feat: add Firestore REST helpers with serialization"
```

---

## Task 3: Firebase ID token verification + requireTeacher middleware

**Files:**
- Create: `src/utils/verifyTeacherToken.ts`
- Create: `src/utils/verifyTeacherToken.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/utils/verifyTeacherToken.test.ts
import { describe, it, expect } from 'vitest'
import { verifyFirebaseIdToken, requireTeacher } from './verifyTeacherToken'
import { Hono } from 'hono'
import type { Env } from '../index'

// Helper: build a fake JWT with given payload (no real signature)
function fakeJwt(header: object, payload: object, sig = 'fakesig'): string {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${enc(header)}.${enc(payload)}.${enc({ s: sig })}`
}

const PROJECT_ID = 'test-project'
const mockEnv = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: PROJECT_ID }) } as Env

describe('verifyFirebaseIdToken — claim checks (no network)', () => {
  it('throws on token with fewer than 3 parts', async () => {
    await expect(verifyFirebaseIdToken('a.b', PROJECT_ID)).rejects.toThrow('Invalid JWT format')
  })

  it('throws on expired token', async () => {
    const token = fakeJwt(
      { alg: 'RS256', kid: 'k1' },
      { exp: 1, iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID, sub: 'uid1' }
    )
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow('Token expired')
  })

  it('throws on wrong issuer', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const token = fakeJwt(
      { alg: 'RS256', kid: 'k1' },
      { exp: future, iss: 'https://evil.issuer', aud: PROJECT_ID, sub: 'uid1' }
    )
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow('Invalid issuer')
  })

  it('throws on wrong audience', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const token = fakeJwt(
      { alg: 'RS256', kid: 'k1' },
      { exp: future, iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: 'other-project', sub: 'uid1' }
    )
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow('Invalid audience')
  })

  it('throws on missing kid in header', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const token = fakeJwt(
      { alg: 'RS256' },  // no kid
      { exp: future, iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID, sub: 'uid1' }
    )
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow('Missing key ID')
  })
})

describe('requireTeacher middleware', () => {
  function makeApp() {
    const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
    app.use('*', requireTeacher)
    app.get('/', (c) => c.json({ uid: c.get('teacherUid') }))
    return app
  }

  it('returns 401 with no Authorization header', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/'), mockEnv)
    expect(res.status).toBe(401)
  })

  it('returns 401 with non-Bearer Authorization', async () => {
    const app = makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', { headers: { Authorization: 'Basic abc' } }),
      mockEnv
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 with a malformed token (not 3 parts)', async () => {
    const app = makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', { headers: { Authorization: 'Bearer not.valid' } }),
      mockEnv
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- src/utils/verifyTeacherToken.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/utils/verifyTeacherToken.ts`**

```typescript
// src/utils/verifyTeacherToken.ts
/**
 * Firebase ID Token verification for Cloudflare Workers.
 * Uses Web Crypto API (crypto.subtle) to verify RS256 JWT signatures
 * against Google's public JWK endpoint — no Firebase Admin SDK needed.
 */

import type { Env } from '../index';
import type { MiddlewareHandler } from 'hono';

interface JWTPayload {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  email?: string;
  role?: string;
}

interface CachedKeys {
  keys: Record<string, CryptoKey>;
  expiresAt: number;
}

let cachedKeys: CachedKeys | null = null;

async function getGooglePublicKeys(): Promise<Record<string, CryptoKey>> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) {
    return cachedKeys.keys;
  }

  const res = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) throw new Error('Failed to fetch Google public keys');

  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const keyMap: Record<string, CryptoKey> = {};

  for (const jwk of keys) {
    if (!jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    keyMap[jwk.kid] = key;
  }

  // Cache for 6 hours (keys rotate roughly every 6–12 hours)
  cachedKeys = { keys: keyMap, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return keyMap;
}

function decodeBase64url(s: string): string {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string
): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const header = JSON.parse(decodeBase64url(parts[0])) as { kid?: string };
  const payload = JSON.parse(decodeBase64url(parts[1])) as JWTPayload;

  if (payload.exp < Date.now() / 1000) throw new Error('Token expired');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Invalid issuer');
  if (payload.aud !== projectId) throw new Error('Invalid audience');
  if (!header.kid) throw new Error('Missing key ID in token header');

  const publicKeys = await getGooglePublicKeys();
  const pubKey = publicKeys[header.kid];
  if (!pubKey) throw new Error(`Unknown key ID: ${header.kid}`);

  const sigData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sigBytes = Uint8Array.from(decodeBase64url(parts[2]), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pubKey, sigBytes, sigData);
  if (!valid) throw new Error('Invalid signature');

  return payload;
}

export const requireTeacher: MiddlewareHandler<{
  Bindings: Env;
  Variables: { teacherUid: string };
}> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);

  try {
    const { project_id } = JSON.parse(c.env.FIREBASE_SERVICE_ACCOUNT) as { project_id: string };
    const payload = await verifyFirebaseIdToken(token, project_id);

    if (payload.role !== 'teacher') {
      return c.json({ success: false, error: 'Forbidden: teacher role required' }, 403);
    }

    c.set('teacherUid', payload.sub);
    await next();
  } catch {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/utils/verifyTeacherToken.test.ts
```

Expected: All 7 tests pass (the claim-check tests run without network; the middleware tests use malformed tokens that fail before any network call).

- [ ] **Step 5: Commit**

```bash
git add src/utils/verifyTeacherToken.ts src/utils/verifyTeacherToken.test.ts
git commit -m "feat: add Firebase ID token verification and requireTeacher middleware"
```

---

## Task 4: Teacher domain types + update `src/index.ts`

**Files:**
- Create: `src/teacher/types.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create `src/teacher/types.ts`**

```typescript
// src/teacher/types.ts

export interface ClassDoc {
  id: string;
  name: string;
  teacherId: string;
  schoolId: string;
  studentIds: string[];
  gridConfig: { rows: number; cols: number };
  deskPositions: Record<string, { col: number; row: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherDoc {
  uid: string;
  displayName: string;
  email: string;
  schoolId: string;
  classIds: string[];
  theme: 'dark' | 'light';
  createdAt: string;
}

export interface ClassGoalDoc {
  classId: string;
  teacherId: string;
  topics: Array<{ leitidee: string; thema: string; unterthema: string }>;
  examDate: string | null;
  setAt: string;
}

export interface StudentSummary {
  uid: string;
  displayName: string;
  email: string;
  lastActive: string | null;
  accuracy7d: number;       // 0–100 percentage
  streak: number;
  totalXp: number;
  status: 'active' | 'idle' | 'struggling' | 'offline';
  currentTopic: string | null;
  sessionProgress: { answered: number; total: number } | null;
}

export interface TopicAccuracy {
  leitidee: string;
  thema: string;
  unterthema: string;
  correct: number;
  incorrect: number;
  accuracyPct: number;
  isWissensluecke: boolean;   // accuracyPct < 60
}

export interface FeedEntry {
  userId: string;
  displayName: string;
  questionText: string;
  studentAnswer: string;
  isCorrect: boolean;
  feedback: string;
  hintsUsed: number;
  timeSpentSeconds: number;
  timestamp: number;          // Unix timestamp (int) as stored by student app
  leitidee: string;
  thema: string;
  unterthema: string;
}

export interface AnalyticsSummary {
  questionsToday: number;
  questionsThisWeek: number;
  classAverageAccuracy: number;
  avgDailyStreak: number;
  activeStudentsToday: number;
}
```

- [ ] **Step 2: Update `src/index.ts` — add `Variables` type and teacher route imports**

Change line 37 from:
```typescript
const app = new Hono<{ Bindings: Env }>();
```

to:
```typescript
const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>();
```

And add a new `FIREBASE_API_KEY` field to the `Env` interface (needed later in Task 11):
```typescript
export interface Env {
  ENVIRONMENT: string;
  GEMINI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  FIREBASE_API_KEY: string;   // ← ADD THIS LINE
}
```

And add these imports + route registrations **after** line 14 (`import { handleCollaborativeCanvas ...}`) and **before** the `app.get('/', ...)` health check:

```typescript
// Teacher dashboard routes
import { requireTeacher } from './utils/verifyTeacherToken';
import meRouter from './teacher/me';
import classesRouter from './teacher/classes';
import analyticsRouter from './teacher/analytics';
import goalsRouter from './teacher/goals';
import studentsRouter from './teacher/students';
```

And these route registrations, **between** the CORS middleware block and the health check route (after line 63):

```typescript
// ============================================================================
// TEACHER DASHBOARD ROUTES (all require role: "teacher" Firebase claim)
// ============================================================================
app.use('/api/teacher/*', requireTeacher);
app.route('/api/teacher/me', meRouter);
app.route('/api/teacher/class', classesRouter);
app.route('/api/teacher/class', analyticsRouter);
app.route('/api/teacher/class', goalsRouter);
app.route('/api/teacher/student', studentsRouter);
```

Also update the health check `endpoints` array to include the new routes:
```typescript
'GET  /api/teacher/me',
'PUT  /api/teacher/me',
'GET  /api/teacher/class/:classId/students',
'GET  /api/teacher/class/:classId/analytics',
'GET  /api/teacher/class/:classId/feed',
'POST /api/teacher/class/:classId/goal',
'PATCH /api/teacher/class/:classId',
'POST /api/teacher/class',
'DELETE /api/teacher/class/:classId',
'POST /api/teacher/class/:classId/students',
'DELETE /api/teacher/class/:classId/students/:userId',
'POST /api/teacher/student/:userId/ai-assessment',
'POST /api/teacher/student/invite',
'POST /api/teacher/student/reset-password',
```

- [ ] **Step 3: Type-check to verify no errors**

```bash
npm run type-check
```

Expected: errors for missing router files (me, classes, analytics, goals, students) — this is expected and will be resolved in subsequent tasks.

- [ ] **Step 4: Commit `types.ts` only (index.ts updates will land incrementally)**

```bash
git add src/teacher/types.ts
git commit -m "feat: add teacher domain types"
```

---

## Task 5: Teacher profile endpoints

**Files:**
- Create: `src/teacher/me.ts`
- Create: `src/teacher/me.test.ts`
- Modify: `src/index.ts` (add import + route — partial update from Task 4)

- [ ] **Step 1: Write the failing tests**

```typescript
// src/teacher/me.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

// We bypass auth in all handler tests. The middleware is tested separately.
async function makeApp() {
  const { default: router } = await import('./me')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-proj' }),
  FIREBASE_API_KEY: 'key',
  ANTHROPIC_API_KEY: 'key',
  GEMINI_API_KEY: 'key',
  ENVIRONMENT: 'test',
} as Env

describe('GET /api/teacher/me', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns teacher profile when doc exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      // First call: GET Firebase access token
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
    ).mockResolvedValueOnce(
      // Second call: Firestore GET teachers/teacher-uid-1
      new Response(JSON.stringify({
        name: 'projects/test-proj/databases/(default)/documents/teachers/teacher-uid-1',
        fields: {
          uid: { stringValue: 'teacher-uid-1' },
          displayName: { stringValue: 'Frau Müller' },
          email: { stringValue: 'mueller@mvl-gym.de' },
          schoolId: { stringValue: 'mvl' },
          classIds: { arrayValue: { values: [] } },
          theme: { stringValue: 'dark' },
          createdAt: { stringValue: '2026-01-01T00:00:00Z' },
        },
      }))
    ))

    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/'), mockEnv)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.displayName).toBe('Frau Müller')
    expect(body.email).toBe('mueller@mvl-gym.de')
  })

  it('returns 404 when teacher doc does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
    ).mockResolvedValueOnce(
      new Response('', { status: 404 })
    ))

    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/'), mockEnv)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/teacher/me', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('updates displayName and theme', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      // GET existing doc
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: 'projects/test-proj/databases/(default)/documents/teachers/teacher-uid-1',
        fields: {
          uid: { stringValue: 'teacher-uid-1' },
          displayName: { stringValue: 'Old Name' },
          email: { stringValue: 'mueller@mvl-gym.de' },
          schoolId: { stringValue: 'mvl' },
          classIds: { arrayValue: { values: [] } },
          theme: { stringValue: 'dark' },
          createdAt: { stringValue: '2026-01-01T00:00:00Z' },
        },
      })))
      // PATCH updated doc
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: 'projects/test-proj/databases/(default)/documents/teachers/teacher-uid-1',
        fields: {
          uid: { stringValue: 'teacher-uid-1' },
          displayName: { stringValue: 'Frau Müller' },
          email: { stringValue: 'mueller@mvl-gym.de' },
          schoolId: { stringValue: 'mvl' },
          classIds: { arrayValue: { values: [] } },
          theme: { stringValue: 'light' },
          createdAt: { stringValue: '2026-01-01T00:00:00Z' },
        },
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Frau Müller', theme: 'light' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.displayName).toBe('Frau Müller')
    expect(body.theme).toBe('light')
  })

  it('returns 404 when updating non-existent teacher', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'New Name' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- src/teacher/me.test.ts
```

Expected: FAIL — `me.ts` not found.

- [ ] **Step 3: Write `src/teacher/me.ts`**

```typescript
// src/teacher/me.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { APIError } from '../types';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch } from '../utils/firestore';
import type { TeacherDoc } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

router.get('/', async (c) => {
  const teacherUid = c.get('teacherUid');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  const doc = await fsGet(projectId, accessToken, `teachers/${teacherUid}`);
  if (!doc) return c.json({ success: false, error: 'Teacher profile not found' }, 404);
  return c.json(doc);
});

router.put('/', async (c) => {
  const teacherUid = c.get('teacherUid');
  const body = await c.req.json<{ displayName?: string; theme?: 'dark' | 'light' }>();
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  const existing = await fsGet(projectId, accessToken, `teachers/${teacherUid}`);
  if (!existing) return c.json({ success: false, error: 'Teacher profile not found' }, 404);

  const updated: TeacherDoc = {
    ...(existing as unknown as TeacherDoc),
    ...(body.displayName !== undefined && { displayName: body.displayName }),
    ...(body.theme !== undefined && { theme: body.theme }),
  };

  const result = await fsPatch(projectId, accessToken, `teachers/${teacherUid}`, updated as unknown as Record<string, unknown>);
  return c.json(result);
});

export default router;
```

- [ ] **Step 4: Register the route in `src/index.ts`**

Add this import after the existing handler imports:
```typescript
import { requireTeacher } from './utils/verifyTeacherToken';
import meRouter from './teacher/me';
```

Add these lines after the CORS middleware block (after line 63):
```typescript
app.use('/api/teacher/*', requireTeacher);
app.route('/api/teacher/me', meRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- src/teacher/me.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 6: Type-check**

```bash
npm run type-check
```

Expected: Errors only for the not-yet-created router files (classes, analytics, goals, students) — those imports in `index.ts` aren't added yet.

- [ ] **Step 7: Commit**

```bash
git add src/teacher/me.ts src/teacher/me.test.ts src/index.ts
git commit -m "feat: add GET/PUT /api/teacher/me endpoints"
```

---

## Task 6: Class CRUD

**Files:**
- Create: `src/teacher/classes.ts`
- Create: `src/teacher/classes.test.ts`
- Modify: `src/index.ts` (add import + route)

- [ ] **Step 1: Write the failing tests**

```typescript
// src/teacher/classes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

async function makeApp() {
  const { default: router } = await import('./classes')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-proj' }),
  FIREBASE_API_KEY: 'key',
  ANTHROPIC_API_KEY: 'key',
  GEMINI_API_KEY: 'key',
  ENVIRONMENT: 'test',
} as Env

const mockClassDoc = {
  name: 'projects/test-proj/databases/(default)/documents/classes/cls-abc',
  fields: {
    id: { stringValue: 'cls-abc' },
    name: { stringValue: '11a' },
    teacherId: { stringValue: 'teacher-uid-1' },
    schoolId: { stringValue: 'mvl' },
    studentIds: { arrayValue: { values: [] } },
    gridConfig: { mapValue: { fields: { rows: { integerValue: '4' }, cols: { integerValue: '5' } } } },
    deskPositions: { mapValue: { fields: {} } },
    createdAt: { stringValue: '2026-01-01T00:00:00Z' },
    updatedAt: { stringValue: '2026-01-01T00:00:00Z' },
  },
}

describe('POST /api/teacher/class', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('creates a new class and returns it', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      // PATCH teacher doc (update classIds) → no need to return specifics
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: {} })))
      // PATCH new class doc
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc)))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '11a', gridConfig: { rows: 4, cols: 5 } }),
      }),
      mockEnv
    )
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.name).toBe('11a')
    expect(body.teacherId).toBe('teacher-uid-1')
  })

  it('returns 400 when name is missing', async () => {
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      mockEnv
    )
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/teacher/class/:classId', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('updates class name', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      // GET class doc
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc)))
      // PATCH updated doc
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...mockClassDoc,
        fields: { ...mockClassDoc.fields, name: { stringValue: '11b' } },
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '11b' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(200)
  })

  it('returns 403 when teacher does not own the class', async () => {
    const foreignClassDoc = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClassDoc)))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'hack' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/teacher/class/:classId', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('deletes class and returns 204', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc))) // GET
      .mockResolvedValueOnce(new Response('')) // DELETE
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc', { method: 'DELETE' }),
      mockEnv
    )
    expect(res.status).toBe(204)
  })

  it('returns 403 for a class owned by another teacher', async () => {
    const foreignClassDoc = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClassDoc)))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc', { method: 'DELETE' }),
      mockEnv
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- src/teacher/classes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/teacher/classes.ts` (CRUD only)**

```typescript
// src/teacher/classes.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch, fsDelete } from '../utils/firestore';
import type { ClassDoc } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

/** Generate a nanoid-style unique ID using Web Crypto. */
function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

/** Read a class doc and verify it belongs to teacherUid. Throws 403 on mismatch. */
async function getOwnedClass(
  projectId: string,
  accessToken: string,
  classId: string,
  teacherUid: string
): Promise<ClassDoc> {
  const doc = await fsGet(projectId, accessToken, `classes/${classId}`);
  if (!doc) throw Object.assign(new Error('Class not found'), { status: 404 });
  if (doc.teacherId !== teacherUid) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return doc as unknown as ClassDoc;
}

// POST /api/teacher/class — create a new class
router.post('/', async (c) => {
  const teacherUid = c.get('teacherUid');
  const body = await c.req.json<{ name?: string; gridConfig?: { rows: number; cols: number } }>();

  if (!body.name?.trim()) {
    return c.json({ success: false, error: 'name is required' }, 400);
  }

  const { projectId, accessToken } = await getFirebaseConfig(c.env);
  const classId = generateId();
  const now = new Date().toISOString();

  const classDoc: ClassDoc = {
    id: classId,
    name: body.name.trim(),
    teacherId: teacherUid,
    schoolId: 'mvl',
    studentIds: [],
    gridConfig: body.gridConfig ?? { rows: 4, cols: 5 },
    deskPositions: {},
    createdAt: now,
    updatedAt: now,
  };

  const result = await fsPatch(
    projectId,
    accessToken,
    `classes/${classId}`,
    classDoc as unknown as Record<string, unknown>
  );

  return c.json(result, 201);
});

// PATCH /api/teacher/class/:classId — update name, gridConfig, or deskPositions
router.patch('/:classId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const body = await c.req.json<{
    name?: string;
    gridConfig?: { rows: number; cols: number };
    deskPositions?: Record<string, { col: number; row: number }>;
  }>();

  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let existing: ClassDoc;
  try {
    existing = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const updated: ClassDoc = {
    ...existing,
    ...(body.name !== undefined && { name: body.name }),
    ...(body.gridConfig !== undefined && { gridConfig: body.gridConfig }),
    ...(body.deskPositions !== undefined && { deskPositions: body.deskPositions }),
    updatedAt: new Date().toISOString(),
  };

  const result = await fsPatch(
    projectId,
    accessToken,
    `classes/${classId}`,
    updated as unknown as Record<string, unknown>
  );
  return c.json(result);
});

// DELETE /api/teacher/class/:classId
router.delete('/:classId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');

  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  try {
    await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  await fsDelete(projectId, accessToken, `classes/${classId}`);
  return new Response(null, { status: 204 });
});

export default router;
```

- [ ] **Step 4: Register in `src/index.ts`**

Add import:
```typescript
import classesRouter from './teacher/classes';
```

Add route registration (after the existing `app.route('/api/teacher/me', meRouter)` line):
```typescript
app.route('/api/teacher/class', classesRouter);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/teacher/classes.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/teacher/classes.ts src/teacher/classes.test.ts src/index.ts
git commit -m "feat: add class CRUD endpoints (create, update, delete)"
```

---

## Task 7: Class student membership

**Files:**
- Modify: `src/teacher/classes.ts` (add GET students, POST add-students, DELETE remove-student)
- Modify: `src/teacher/classes.test.ts` (add new tests)

- [ ] **Step 1: Add tests to `src/teacher/classes.test.ts`**

Append to the existing test file:

```typescript
describe('GET /api/teacher/class/:classId/students', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns student summaries for the class', async () => {
    const studentUserDoc = {
      name: 'projects/test-proj/databases/(default)/documents/users/student-uid-1',
      fields: {
        uid: { stringValue: 'student-uid-1' },
        displayName: { stringValue: 'Max Mustermann' },
        email: { stringValue: 'max@mvl-gym.de' },
        streak: { integerValue: '5' },
        totalXp: { integerValue: '1200' },
      },
    }
    const classWithStudent = {
      ...mockClassDoc,
      fields: {
        ...mockClassDoc.fields,
        studentIds: { arrayValue: { values: [{ stringValue: 'student-uid-1' }] } },
      },
    }

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(classWithStudent))) // GET class
      .mockResolvedValueOnce(new Response(JSON.stringify(studentUserDoc))) // GET user
      .mockResolvedValueOnce(new Response(JSON.stringify({ documents: [] }))) // query latest session (404-style empty)
      .mockResolvedValueOnce(new Response(JSON.stringify([]))) // query questionHistory
    )

    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/cls-abc/students'), mockEnv)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].uid).toBe('student-uid-1')
    expect(body[0].displayName).toBe('Max Mustermann')
    expect(['active', 'idle', 'struggling', 'offline']).toContain(body[0].status)
  })

  it('returns 403 for a class owned by another teacher', async () => {
    const foreignClassDoc = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClassDoc)))
    )

    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/cls-abc/students'), mockEnv)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/teacher/class/:classId/students', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('adds student UIDs to the class', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc)))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...mockClassDoc,
        fields: {
          ...mockClassDoc.fields,
          studentIds: { arrayValue: { values: [{ stringValue: 'new-student-uid' }] } },
        },
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: ['new-student-uid'] }),
      }),
      mockEnv
    )
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/teacher/class/:classId/students/:userId', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('removes a student from the class', async () => {
    const classWithStudent = {
      ...mockClassDoc,
      fields: {
        ...mockClassDoc.fields,
        studentIds: { arrayValue: { values: [{ stringValue: 'student-to-remove' }] } },
      },
    }

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(classWithStudent)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...mockClassDoc })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/students/student-to-remove', { method: 'DELETE' }),
      mockEnv
    )
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
npm test -- src/teacher/classes.test.ts
```

Expected: The 3 new test suites fail; existing 6 still pass.

- [ ] **Step 3: Add student membership handlers to `src/teacher/classes.ts`**

Append **before** the `export default router` line:

```typescript
// GET /api/teacher/class/:classId/students — roster with live status
router.get('/:classId/students', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  const thirtyMin = 30 * 60 * 1000;

  const students = await Promise.all(
    cls.studentIds.map(async (uid) => {
      // Fetch user profile
      const userDoc = await fsGet(projectId, accessToken, `users/${uid}`);
      if (!userDoc) {
        return {
          uid,
          displayName: uid,
          email: '',
          lastActive: null,
          accuracy7d: 0,
          streak: 0,
          totalXp: 0,
          status: 'offline' as const,
          currentTopic: null,
          sessionProgress: null,
        };
      }

      // Fetch latest learning session to determine status
      const sessions = await fsQuery(projectId, accessToken, `users/${uid}`, {
        from: [{ collectionId: 'learningSessions' }],
        orderBy: [{ field: { fieldPath: 'startedAt' }, direction: 'DESCENDING' }],
        limit: 1,
      });

      // Fetch recent question history for 7-day accuracy
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentQuestions = await fsQuery(projectId, accessToken, `users/${uid}`, {
        from: [{ collectionId: 'questionHistory' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'timestamp' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { integerValue: String(new Date(sevenDaysAgo).getTime()) },
          },
        },
        orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
        limit: 50,
      });

      const totalQ = recentQuestions.length;
      const correctQ = recentQuestions.filter((q) => q.isCorrect === true).length;
      const accuracy7d = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

      // Determine status from latest session
      let status: 'active' | 'idle' | 'struggling' | 'offline' = 'offline';
      let lastActive: string | null = null;
      let sessionProgress: { answered: number; total: number } | null = null;
      let currentTopic: string | null = null;

      if (sessions.length > 0) {
        const session = sessions[0];
        const sessionTime = new Date(session.startedAt as string).getTime();
        const elapsed = now - sessionTime;

        lastActive = session.startedAt as string;
        sessionProgress = {
          answered: (session.questionsCompleted as number) ?? 0,
          total: (session.questionsTotal as number) ?? 0,
        };

        if (elapsed < fiveMin) {
          status = correctQ < totalQ / 2 && totalQ >= 5 ? 'struggling' : 'active';
        } else if (elapsed < thirtyMin) {
          status = 'idle';
        } else {
          status = 'offline';
        }
      }

      return {
        uid,
        displayName: (userDoc.displayName as string) ?? uid,
        email: (userDoc.email as string) ?? '',
        lastActive,
        accuracy7d,
        streak: (userDoc.streak as number) ?? 0,
        totalXp: (userDoc.totalXp as number) ?? 0,
        status,
        currentTopic,
        sessionProgress,
      };
    })
  );

  return c.json(students);
});

// POST /api/teacher/class/:classId/students — add one or more students
router.post('/:classId/students', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const body = await c.req.json<{ studentIds?: string[] }>();

  if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
    return c.json({ success: false, error: 'studentIds array is required' }, 400);
  }

  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const merged = [...new Set([...cls.studentIds, ...body.studentIds])];
  const updated: ClassDoc = {
    ...cls,
    studentIds: merged,
    updatedAt: new Date().toISOString(),
  };

  const result = await fsPatch(
    projectId,
    accessToken,
    `classes/${classId}`,
    updated as unknown as Record<string, unknown>
  );
  return c.json(result);
});

// DELETE /api/teacher/class/:classId/students/:userId — remove a student
router.delete('/:classId/students/:userId', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const userId = c.req.param('userId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const updated: ClassDoc = {
    ...cls,
    studentIds: cls.studentIds.filter((id) => id !== userId),
    updatedAt: new Date().toISOString(),
  };

  const result = await fsPatch(
    projectId,
    accessToken,
    `classes/${classId}`,
    updated as unknown as Record<string, unknown>
  );
  return c.json(result);
});
```

- [ ] **Step 4: Run all tests**

```bash
npm test -- src/teacher/classes.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/teacher/classes.ts src/teacher/classes.test.ts
git commit -m "feat: add class student membership endpoints (get, add, remove)"
```

---

## Task 8: Analytics and feed

**Files:**
- Create: `src/teacher/analytics.ts`
- Create: `src/teacher/analytics.test.ts`
- Modify: `src/index.ts` (add import + route)

- [ ] **Step 1: Write the failing tests**

```typescript
// src/teacher/analytics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

async function makeApp() {
  const { default: router } = await import('./analytics')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-proj' }),
  FIREBASE_API_KEY: 'key',
  ANTHROPIC_API_KEY: 'key',
  GEMINI_API_KEY: 'key',
  ENVIRONMENT: 'test',
} as Env

const mockClassDoc = {
  name: 'projects/test-proj/databases/(default)/documents/classes/cls-abc',
  fields: {
    teacherId: { stringValue: 'teacher-uid-1' },
    studentIds: {
      arrayValue: {
        values: [
          { stringValue: 'student-1' },
          { stringValue: 'student-2' },
        ],
      },
    },
    gridConfig: { mapValue: { fields: { rows: { integerValue: '4' }, cols: { integerValue: '5' } } } },
    deskPositions: { mapValue: { fields: {} } },
  },
}

// Two questionHistory entries for one student
const mockQuestionHistory = [
  {
    document: {
      name: 'projects/test-proj/databases/(default)/documents/users/student-1/questionHistory/q1',
      fields: {
        isCorrect: { booleanValue: true },
        leitidee: { stringValue: 'Analysis' },
        thema: { stringValue: 'Ableitungen' },
        unterthema: { stringValue: 'Potenzregel' },
        timestamp: { integerValue: String(Date.now()) },
        questionsCompleted: { integerValue: '1' },
        questionsTotal: { integerValue: '10' },
        feedback: { stringValue: 'Gut gemacht!' },
        questionText: { stringValue: 'Was ist die Ableitung von x²?' },
        userAnswer: { stringValue: '2x' },
        hintsUsed: { integerValue: '0' },
        timeSpentSeconds: { integerValue: '30' },
      },
    },
  },
  {
    document: {
      name: 'projects/test-proj/databases/(default)/documents/users/student-1/questionHistory/q2',
      fields: {
        isCorrect: { booleanValue: false },
        leitidee: { stringValue: 'Analysis' },
        thema: { stringValue: 'Ableitungen' },
        unterthema: { stringValue: 'Potenzregel' },
        timestamp: { integerValue: String(Date.now()) },
        questionsCompleted: { integerValue: '2' },
        questionsTotal: { integerValue: '10' },
        feedback: { stringValue: 'Nicht ganz.' },
        questionText: { stringValue: 'Was ist die Ableitung von x³?' },
        userAnswer: { stringValue: 'x²' },
        hintsUsed: { integerValue: '1' },
        timeSpentSeconds: { integerValue: '45' },
      },
    },
  },
]

describe('GET /api/teacher/class/:classId/analytics', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns summary and topic breakdown', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc))) // GET class
      // Two students: each gets a questionHistory query and a user doc
      .mockResolvedValueOnce(new Response(JSON.stringify(mockQuestionHistory))) // student-1 history
      .mockResolvedValueOnce(new Response(JSON.stringify({ // student-1 user doc
        name: 'projects/test-proj/databases/(default)/documents/users/student-1',
        fields: { streak: { integerValue: '3' } },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))  // student-2 history (empty)
      .mockResolvedValueOnce(new Response(JSON.stringify({ // student-2 user doc
        name: 'projects/test-proj/databases/(default)/documents/users/student-2',
        fields: { streak: { integerValue: '1' } },
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/analytics'),
      mockEnv
    )
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toHaveProperty('summary')
    expect(body).toHaveProperty('topics')
    expect(typeof body.summary.classAverageAccuracy).toBe('number')
    expect(Array.isArray(body.topics)).toBe(true)
    // Potenzregel: 1 correct + 1 wrong = 50% accuracy → isWissensluecke true
    const topic = body.topics.find((t: any) => t.unterthema === 'Potenzregel')
    expect(topic).toBeDefined()
    expect(topic.isWissensluecke).toBe(true)
  })

  it('returns 403 for a class owned by another teacher', async () => {
    const foreignClassDoc = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClassDoc)))
    )

    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/cls-abc/analytics'), mockEnv)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/teacher/class/:classId/feed', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns merged feed entries from all students', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc))) // GET class
      .mockResolvedValueOnce(new Response(JSON.stringify(mockQuestionHistory))) // student-1
      .mockResolvedValueOnce(new Response(JSON.stringify({ // student-1 user doc
        name: 'projects/test-proj/databases/(default)/documents/users/student-1',
        fields: { displayName: { stringValue: 'Max' } },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify([]))) // student-2
      .mockResolvedValueOnce(new Response(JSON.stringify({ // student-2 user doc
        name: 'projects/test-proj/databases/(default)/documents/users/student-2',
        fields: { displayName: { stringValue: 'Anna' } },
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/feed'),
      mockEnv
    )
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.entries)).toBe(true)
    expect(body.entries.length).toBe(2)
    expect(body.entries[0]).toHaveProperty('questionText')
    expect(body.entries[0]).toHaveProperty('isCorrect')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- src/teacher/analytics.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/teacher/analytics.ts`**

```typescript
// src/teacher/analytics.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsQuery } from '../utils/firestore';
import type { ClassDoc, TopicAccuracy, AnalyticsSummary, FeedEntry } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

async function getOwnedClass(
  projectId: string,
  accessToken: string,
  classId: string,
  teacherUid: string
): Promise<ClassDoc> {
  const doc = await fsGet(projectId, accessToken, `classes/${classId}`);
  if (!doc) throw Object.assign(new Error('Class not found'), { status: 404 });
  if (doc.teacherId !== teacherUid) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return doc as unknown as ClassDoc;
}

// GET /api/teacher/class/:classId/analytics
router.get('/:classId/analytics', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = now - dayMs;
  const weekStart = now - 7 * dayMs;

  // Fetch per-student data in parallel
  const studentData = await Promise.all(
    cls.studentIds.map(async (uid) => {
      const [history, userDoc] = await Promise.all([
        fsQuery(projectId, accessToken, `users/${uid}`, {
          from: [{ collectionId: 'questionHistory' }],
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          limit: 200,
        }),
        fsGet(projectId, accessToken, `users/${uid}`),
      ]);
      return { uid, history, userDoc };
    })
  );

  // Aggregate
  const topicMap = new Map<string, { leitidee: string; thema: string; unterthema: string; correct: number; incorrect: number }>();
  let questionsToday = 0;
  let questionsThisWeek = 0;
  let totalCorrect = 0;
  let totalAnswered = 0;
  let activeStudentsToday = 0;
  let totalStreak = 0;
  let studentCount = 0;

  for (const { history, userDoc } of studentData) {
    let studentActiveToday = false;
    for (const q of history) {
      const ts = q.timestamp as number;
      if (ts > todayStart) {
        questionsToday++;
        studentActiveToday = true;
      }
      if (ts > weekStart) questionsThisWeek++;

      const isCorrect = q.isCorrect === true;
      const key = `${q.leitidee}|${q.thema}|${q.unterthema}`;
      const entry = topicMap.get(key) ?? {
        leitidee: q.leitidee as string,
        thema: q.thema as string,
        unterthema: q.unterthema as string,
        correct: 0,
        incorrect: 0,
      };
      if (isCorrect) { entry.correct++; totalCorrect++; }
      else { entry.incorrect++; }
      totalAnswered++;
      topicMap.set(key, entry);
    }

    if (studentActiveToday) activeStudentsToday++;
    if (userDoc) {
      totalStreak += (userDoc.streak as number) ?? 0;
      studentCount++;
    }
  }

  const classAverageAccuracy = totalAnswered > 0
    ? Math.round((totalCorrect / totalAnswered) * 100)
    : 0;

  const avgDailyStreak = studentCount > 0
    ? Math.round(totalStreak / studentCount)
    : 0;

  const summary: AnalyticsSummary = {
    questionsToday,
    questionsThisWeek,
    classAverageAccuracy,
    avgDailyStreak,
    activeStudentsToday,
  };

  const topics: TopicAccuracy[] = Array.from(topicMap.values()).map((t) => {
    const total = t.correct + t.incorrect;
    const accuracyPct = total > 0 ? Math.round((t.correct / total) * 100) : 0;
    return {
      leitidee: t.leitidee,
      thema: t.thema,
      unterthema: t.unterthema,
      correct: t.correct,
      incorrect: t.incorrect,
      accuracyPct,
      isWissensluecke: accuracyPct < 60,
    };
  });

  return c.json({ summary, topics });
});

// GET /api/teacher/class/:classId/feed
router.get('/:classId/feed', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  let cls: ClassDoc;
  try {
    cls = await getOwnedClass(projectId, accessToken, classId, teacherUid);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, e.status ?? 500);
  }

  const studentData = await Promise.all(
    cls.studentIds.map(async (uid) => {
      const [history, userDoc] = await Promise.all([
        fsQuery(projectId, accessToken, `users/${uid}`, {
          from: [{ collectionId: 'questionHistory' }],
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          limit: 20,
        }),
        fsGet(projectId, accessToken, `users/${uid}`),
      ]);
      return { uid, displayName: (userDoc?.displayName as string) ?? uid, history };
    })
  );

  const entries: FeedEntry[] = [];
  for (const { uid, displayName, history } of studentData) {
    for (const q of history) {
      entries.push({
        userId: uid,
        displayName,
        questionText: (q.questionText as string) ?? '',
        studentAnswer: (q.userAnswer as string) ?? '',
        isCorrect: q.isCorrect === true,
        feedback: (q.feedback as string) ?? '',
        hintsUsed: (q.hintsUsed as number) ?? 0,
        timeSpentSeconds: (q.timeSpentSeconds as number) ?? 0,
        timestamp: (q.timestamp as number) ?? 0,
        leitidee: (q.leitidee as string) ?? '',
        thema: (q.thema as string) ?? '',
        unterthema: (q.unterthema as string) ?? '',
      });
    }
  }

  // Sort by most recent first, take top 50
  entries.sort((a, b) => b.timestamp - a.timestamp);

  return c.json({ entries: entries.slice(0, 50) });
});

export default router;
```

- [ ] **Step 4: Register in `src/index.ts`**

Add import:
```typescript
import analyticsRouter from './teacher/analytics';
```

Add route registration (after the classesRouter line):
```typescript
app.route('/api/teacher/class', analyticsRouter);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/teacher/analytics.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/teacher/analytics.ts src/teacher/analytics.test.ts src/index.ts
git commit -m "feat: add class analytics and feed endpoints"
```

---

## Task 9: Learning goals

**Files:**
- Create: `src/teacher/goals.ts`
- Create: `src/teacher/goals.test.ts`
- Modify: `src/index.ts` (add import + route)

- [ ] **Step 1: Write the failing tests**

```typescript
// src/teacher/goals.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

async function makeApp() {
  const { default: router } = await import('./goals')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-proj' }),
  FIREBASE_API_KEY: 'key',
  ANTHROPIC_API_KEY: 'key',
  GEMINI_API_KEY: 'key',
  ENVIRONMENT: 'test',
} as Env

const mockClassDoc = {
  name: 'projects/test-proj/databases/(default)/documents/classes/cls-abc',
  fields: {
    teacherId: { stringValue: 'teacher-uid-1' },
    studentIds: { arrayValue: { values: [] } },
    gridConfig: { mapValue: { fields: { rows: { integerValue: '4' }, cols: { integerValue: '5' } } } },
    deskPositions: { mapValue: { fields: {} } },
  },
}

describe('POST /api/teacher/class/:classId/goal', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('saves class goal to Firestore and returns it', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc))) // verify ownership
      .mockResolvedValueOnce(new Response(JSON.stringify({ // PATCH classGoals doc
        name: 'projects/test-proj/databases/(default)/documents/classGoals/cls-abc',
        fields: {
          classId: { stringValue: 'cls-abc' },
          teacherId: { stringValue: 'teacher-uid-1' },
          topics: {
            arrayValue: {
              values: [{
                mapValue: {
                  fields: {
                    leitidee: { stringValue: 'Analysis' },
                    thema: { stringValue: 'Ableitungen' },
                    unterthema: { stringValue: 'Potenzregel' },
                  },
                },
              }],
            },
          },
          examDate: { stringValue: '2026-06-15' },
          setAt: { stringValue: new Date().toISOString() },
        },
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: [{ leitidee: 'Analysis', thema: 'Ableitungen', unterthema: 'Potenzregel' }],
          examDate: '2026-06-15',
        }),
      }),
      mockEnv
    )
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.classId).toBe('cls-abc')
    expect(body.topics).toHaveLength(1)
    expect(body.examDate).toBe('2026-06-15')
  })

  it('returns 400 when topics array is empty', async () => {
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics: [], examDate: null }),
      }),
      mockEnv
    )
    expect(res.status).toBe(400)
  })

  it('returns 403 when teacher does not own the class', async () => {
    const foreignClass = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClass)))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics: [{ leitidee: 'A', thema: 'B', unterthema: 'C' }], examDate: null }),
      }),
      mockEnv
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- src/teacher/goals.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/teacher/goals.ts`**

```typescript
// src/teacher/goals.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsGet, fsPatch } from '../utils/firestore';
import type { ClassDoc, ClassGoalDoc } from './types';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

// POST /api/teacher/class/:classId/goal
router.post('/:classId/goal', async (c) => {
  const teacherUid = c.get('teacherUid');
  const classId = c.req.param('classId');
  const body = await c.req.json<{
    topics?: Array<{ leitidee: string; thema: string; unterthema: string }>;
    examDate?: string | null;
  }>();

  if (!Array.isArray(body.topics) || body.topics.length === 0) {
    return c.json({ success: false, error: 'topics must be a non-empty array' }, 400);
  }

  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  // Verify ownership
  const classDoc = await fsGet(projectId, accessToken, `classes/${classId}`);
  if (!classDoc) return c.json({ success: false, error: 'Class not found' }, 404);
  if ((classDoc as unknown as ClassDoc).teacherId !== teacherUid) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const goal: ClassGoalDoc = {
    classId,
    teacherId: teacherUid,
    topics: body.topics,
    examDate: body.examDate ?? null,
    setAt: new Date().toISOString(),
  };

  const result = await fsPatch(
    projectId,
    accessToken,
    `classGoals/${classId}`,
    goal as unknown as Record<string, unknown>
  );

  return c.json(result);
});

export default router;
```

- [ ] **Step 4: Register in `src/index.ts`**

Add import:
```typescript
import goalsRouter from './teacher/goals';
```

Add route registration (after the analyticsRouter line):
```typescript
app.route('/api/teacher/class', goalsRouter);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/teacher/goals.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/teacher/goals.ts src/teacher/goals.test.ts src/index.ts
git commit -m "feat: add class learning goals endpoint"
```

---

## Task 10: AI student assessment

**Files:**
- Modify: `src/config/models.json` (add `aiAssessment` task)
- Create: `src/teacher/students.ts`
- Create: `src/teacher/students.test.ts`
- Modify: `src/index.ts` (add import + route)

- [ ] **Step 1: Add `aiAssessment` task to `src/config/models.json`**

Open `src/config/models.json` and add after the last task entry (before the closing `}` of `"tasks"`):

```json
"aiAssessment": {
  "description": "Generate AI prose assessment of a student's learning history for the teacher",
  "provider": "claude",
  "model": "claude-sonnet-4-6",
  "temperature": 0.4,
  "timeout": 30000,
  "maxTokens": 500,
  "systemPrompt": "Du bist ein erfahrener Mathematiklehrer. Du analysierst Lernhistorien von Schülern und gibst präzise, konstruktive Einschätzungen auf Deutsch."
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/teacher/students.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

async function makeApp() {
  const { default: router } = await import('./students')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-proj' }),
  FIREBASE_API_KEY: 'api-key-123',
  ANTHROPIC_API_KEY: 'anthropic-key',
  GEMINI_API_KEY: 'gemini-key',
  ENVIRONMENT: 'test',
} as Env

describe('POST /api/teacher/student/:userId/ai-assessment', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns AI assessment prose for a student', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      // Firestore: query last 50 questionHistory entries
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          document: {
            name: 'projects/test-proj/databases/(default)/documents/users/student-1/questionHistory/q1',
            fields: {
              questionText: { stringValue: 'Was ist 2+2?' },
              userAnswer: { stringValue: '4' },
              isCorrect: { booleanValue: true },
              leitidee: { stringValue: 'Arithmetik' },
              thema: { stringValue: 'Addition' },
              unterthema: { stringValue: 'Grundlagen' },
              timestamp: { integerValue: String(Date.now()) },
            },
          },
        },
      ])))
      // Anthropic API call
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Der Schüler zeigt solide Grundkenntnisse...' }],
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/student-1/ai-assessment', { method: 'POST' }),
      mockEnv
    )
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(typeof body.assessment).toBe('string')
    expect(body.assessment.length).toBeGreaterThan(10)
  })

  it('returns empty assessment when student has no history', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify([]))) // empty history
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Keine Lernhistorie vorhanden.' }],
      })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/student-1/ai-assessment', { method: 'POST' }),
      mockEnv
    )
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- src/teacher/students.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/teacher/students.ts` (AI assessment only)**

```typescript
// src/teacher/students.ts
import { Hono } from 'hono';
import type { Env } from '../index';
import { getFirebaseConfig } from '../utils/firebaseAuth';
import { fsQuery } from '../utils/firestore';
import { callAI } from '../utils/callAI';
import modelsConfig from '../config/models.json';

type AppEnv = { Bindings: Env; Variables: { teacherUid: string } };

const router = new Hono<AppEnv>();

// POST /api/teacher/student/:userId/ai-assessment
router.post('/:userId/ai-assessment', async (c) => {
  const userId = c.req.param('userId');
  const { projectId, accessToken } = await getFirebaseConfig(c.env);

  // Fetch last 50 question history entries
  const history = await fsQuery(projectId, accessToken, `users/${userId}`, {
    from: [{ collectionId: 'questionHistory' }],
    orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
    limit: 50,
  });

  const historyText = history
    .map((q, i) => {
      const status = q.isCorrect ? '✓' : '✗';
      return `${i + 1}. [${status}] ${q.leitidee} › ${q.thema} › ${q.unterthema}: „${q.questionText}" → „${q.userAnswer}"`;
    })
    .join('\n');

  const prompt = history.length > 0
    ? `Lernhistorie der letzten ${history.length} Aufgaben:\n\n${historyText}\n\nBitte erstelle eine kurze Einschätzung (3–4 Sätze) mit: Stärken, wiederkehrenden Flüchtigkeitsfehlern, und einer konkreten Empfehlung für die Lehrkraft.`
    : 'Dieser Schüler hat noch keine Aufgaben bearbeitet. Gib eine kurze Einschätzung.';

  const taskConfig = (modelsConfig as any).tasks.aiAssessment;

  const assessment = await callAI({
    provider: taskConfig.provider,
    model: taskConfig.model,
    prompt,
    temperature: taskConfig.temperature,
    maxTokens: taskConfig.maxTokens,
    systemPrompt: taskConfig.systemPrompt,
    env: c.env,
  });

  return c.json({ assessment, generatedAt: new Date().toISOString() });
});

export default router;
```

- [ ] **Step 5: Register in `src/index.ts`**

Add import:
```typescript
import studentsRouter from './teacher/students';
```

Add route registration (after the goalsRouter line):
```typescript
app.route('/api/teacher/student', studentsRouter);
```

- [ ] **Step 6: Run tests**

```bash
npm test -- src/teacher/students.test.ts
```

Expected: Both tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/config/models.json src/teacher/students.ts src/teacher/students.test.ts src/index.ts
git commit -m "feat: add AI student assessment endpoint"
```

---

## Task 11: Invite and reset-password

**Files:**
- Create: `src/utils/firebaseAdmin.ts`
- Modify: `src/teacher/students.ts` (add invite + reset-password handlers)
- Modify: `src/teacher/students.test.ts` (add tests)
- Modify: `src/index.ts` (already has `FIREBASE_API_KEY` in Env from Task 4)
- Modify: `wrangler.toml` (document new secret)

- [ ] **Step 1: Create `src/utils/firebaseAdmin.ts`**

This module creates Firebase Auth users and sends password-setup emails using the Identity Toolkit REST API, authenticated with the service account.

```typescript
// src/utils/firebaseAdmin.ts
/**
 * Firebase Admin operations via REST API.
 * Used for user management (create, send password reset email).
 * Uses the Firebase Identity Toolkit v1 API.
 */

import type { Env } from '../index';

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

interface AdminTokenCache {
  token: string;
  expiresAt: number;
}

// Separate cache from the datastore token in firebaseAuth.ts
let adminTokenCache: AdminTokenCache | null = null;

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncodeString(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function getAdminToken(serviceAccount: ServiceAccount): Promise<string> {
  if (adminTokenCache && adminTokenCache.expiresAt > Date.now() + 60_000) {
    return adminTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncodeString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlEncodeString(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase',
  }));
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64urlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`Failed to get Firebase admin token: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };

  adminTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

/**
 * Create a new Firebase Auth user with the given email.
 * Returns the new user's UID.
 */
export async function createFirebaseUser(env: Env, email: string, displayName: string): Promise<string> {
  const sa: ServiceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const adminToken = await getAdminToken(sa);

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, displayName, emailVerified: false }),
    }
  );
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err?.error?.message ?? `Failed to create user: ${res.status}`);
  }
  const data = await res.json() as { localId: string };
  return data.localId;
}

/**
 * Send a password reset email to the given address.
 * Uses the Firebase Web API Key (public, not a secret in the same sense).
 */
export async function sendPasswordResetEmail(env: Env, email: string): Promise<void> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    }
  );
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err?.error?.message ?? `Failed to send reset email: ${res.status}`);
  }
}
```

- [ ] **Step 2: Add tests for invite and reset-password to `src/teacher/students.test.ts`**

Append to the existing test file:

```typescript
describe('POST /api/teacher/student/invite', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('creates a user and sends a setup email, returns uid', async () => {
    vi.stubGlobal('fetch', vi.fn()
      // getAdminToken: sign JWT and exchange
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'admin-tok', expires_in: 3600 })))
      // Identity Toolkit: create user
      .mockResolvedValueOnce(new Response(JSON.stringify({ localId: 'new-uid-123' })))
      // getAdminToken (cached, but let's assume it's still the same mock — won't be called again)
      // sendPasswordResetEmail: send OOB code
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'new@mvl-gym.de' })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@mvl-gym.de', displayName: 'Neuer Schüler' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.uid).toBe('new-uid-123')
    expect(body.email).toBe('new@mvl-gym.de')
  })

  it('returns 400 when email is missing', async () => {
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'No Email' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/teacher/student/reset-password', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('sends password reset email and returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'student@mvl-gym.de' })))
    )

    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'student@mvl-gym.de' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(200)
  })

  it('returns 400 when email is missing', async () => {
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      mockEnv
    )
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run to verify new tests fail**

```bash
npm test -- src/teacher/students.test.ts
```

Expected: The 4 new invite/reset tests fail; the 2 assessment tests still pass.

- [ ] **Step 4: Add invite + reset-password handlers to `src/teacher/students.ts`**

Add import at the top:
```typescript
import { createFirebaseUser, sendPasswordResetEmail } from '../utils/firebaseAdmin';
```

Append **before** `export default router`:

```typescript
// POST /api/teacher/student/invite
// IMPORTANT: This route must be registered before /:userId/ai-assessment
// to prevent "invite" being matched as a userId. In Hono, routes are matched
// in registration order, so register this router BEFORE adding more /:userId routes.
router.post('/invite', async (c) => {
  const body = await c.req.json<{ email?: string; displayName?: string }>();
  if (!body.email?.trim()) {
    return c.json({ success: false, error: 'email is required' }, 400);
  }

  const uid = await createFirebaseUser(c.env, body.email.trim(), body.displayName?.trim() ?? '');
  await sendPasswordResetEmail(c.env, body.email.trim());

  return c.json({ uid, email: body.email.trim() }, 201);
});

// POST /api/teacher/student/reset-password
router.post('/reset-password', async (c) => {
  const body = await c.req.json<{ email?: string }>();
  if (!body.email?.trim()) {
    return c.json({ success: false, error: 'email is required' }, 400);
  }

  await sendPasswordResetEmail(c.env, body.email.trim());
  return c.json({ success: true });
});
```

**Important:** Move the `invite` and `reset-password` handlers **above** the `/:userId/ai-assessment` handler in the file so that Hono's route-matching doesn't treat the literal strings `invite` and `reset-password` as `:userId` params. Restructure `students.ts` so the order is:

1. `POST /invite`
2. `POST /reset-password`
3. `POST /:userId/ai-assessment`

- [ ] **Step 5: Update `wrangler.toml` to document the new secret**

Open `wrangler.toml` and update the secrets comment block:

```toml
# Required secrets:
# - GEMINI_API_KEY: Google Gemini API key for AI generation
# - ANTHROPIC_API_KEY: Anthropic Claude API key for AI generation
# - FIREBASE_SERVICE_ACCOUNT: JSON string for Firestore + admin access
# - FIREBASE_API_KEY: Firebase Web API Key (for Identity Toolkit OOB emails)
#
# Example:
#   wrangler secret put GEMINI_API_KEY
#   wrangler secret put ANTHROPIC_API_KEY
#   wrangler secret put FIREBASE_SERVICE_ACCOUNT
#   wrangler secret put FIREBASE_API_KEY
```

- [ ] **Step 6: Run all tests**

```bash
npm test -- src/teacher/students.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: All tests pass across all files.

- [ ] **Step 8: Type-check**

```bash
npm run type-check
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/utils/firebaseAdmin.ts src/teacher/students.ts src/teacher/students.test.ts wrangler.toml
git commit -m "feat: add student invite and password reset endpoints"
```

---

## Post-implementation checklist

Before marking this plan done, verify manually:

- [ ] `npm test` passes — all tests green
- [ ] `npm run type-check` passes — zero errors
- [ ] `wrangler secret put FIREBASE_API_KEY` is documented in the repo (done in Task 11)
- [ ] In Firebase Console: set `{ role: "teacher" }` custom claim on at least one test teacher account to enable end-to-end testing

---

## Self-Review: Spec Coverage

| Spec section | Task(s) |
|---|---|
| §4 Auth — requireTeacher middleware | Task 3 |
| §5 Data model — `teachers/{uid}` | Task 5 (GET/PUT /me) |
| §5 Data model — `classes/{nanoid}` | Task 6 |
| §5 Data model — `classGoals/{classId}` | Task 9 |
| §8 GET students roster + stats | Task 7 |
| §8 GET analytics | Task 8 |
| §8 GET feed | Task 8 |
| §8 POST ai-assessment | Task 10 |
| §8 POST class goal | Task 9 |
| §8 PATCH class config | Task 6 |
| §8 POST class | Task 6 |
| §8 DELETE class | Task 6 |
| §8 POST add students | Task 7 |
| §8 DELETE remove student | Task 7 |
| §8 POST invite | Task 11 |
| §8 POST reset-password | Task 11 |
| §8 GET /me | Task 5 |
| §8 PUT /me | Task 5 |
| §8 AI Assessment prompt (German prose, Claude) | Task 10 |
