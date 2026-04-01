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
