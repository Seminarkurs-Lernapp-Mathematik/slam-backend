import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

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

const mockGoalPatchResponse = {
  name: 'projects/test-proj/databases/(default)/documents/classGoals/cls-abc',
  fields: {
    classId: { stringValue: 'cls-abc' },
    teacherId: { stringValue: 'teacher-uid-1' },
    topics: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                leitidee: { stringValue: 'Analysis' },
                thema: { stringValue: 'Ableitungen' },
                unterthema: { stringValue: 'Potenzregel' },
              },
            },
          },
        ],
      },
    },
    examDate: { stringValue: '2026-06-15' },
    setAt: { stringValue: '2026-03-31T00:00:00.000Z' },
  },
}

async function makeApp() {
  const { default: router } = await import('./goals')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

describe('POST /api/teacher/class/:classId/goal', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  it('saves class goal to Firestore and returns it', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc)))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockGoalPatchResponse)))
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
    expect(body.topics.length).toBe(1)
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
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClass)))
    )
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: [{ leitidee: 'A', thema: 'B', unterthema: 'C' }],
          examDate: null,
        }),
      }),
      mockEnv
    )
    expect(res.status).toBe(403)
  })
})
