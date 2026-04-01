import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'

const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-proj' }),
  FIREBASE_API_KEY: 'api-key-123',
  ANTHROPIC_API_KEY: 'anthropic-key',
  GEMINI_API_KEY: 'gemini-key',
  ENVIRONMENT: 'test',
} as Env

async function makeApp() {
  const { default: router } = await import('./students')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

describe('POST /api/teacher/student/:userId/ai-assessment', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({ projectId: 'test-proj', accessToken: 'test-token' }),
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns AI assessment prose for a student', async () => {
    vi.stubGlobal('fetch', vi.fn()
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
