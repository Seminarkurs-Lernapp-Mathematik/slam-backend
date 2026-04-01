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

async function makeApp() {
  const { default: router } = await import('./classes')
  const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
  app.use('*', async (c, next) => { c.set('teacherUid', 'teacher-uid-1'); await next() })
  app.route('/', router)
  return app
}

describe('POST / (create class)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  it('creates a new class and returns 201', async () => {
    vi.stubGlobal('fetch', vi.fn()
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

describe('PATCH /:classId (update class)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  it('updates class name', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc)))
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
    const foreignClass = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClass)))
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

describe('DELETE /:classId (delete class)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  it('deletes class and returns 204', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mockClassDoc)))
      .mockResolvedValueOnce(new Response(''))
    )
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc', { method: 'DELETE' }),
      mockEnv
    )
    expect(res.status).toBe(204)
  })

  it('returns 403 for a class owned by another teacher', async () => {
    const foreignClass = {
      ...mockClassDoc,
      fields: { ...mockClassDoc.fields, teacherId: { stringValue: 'other-teacher' } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(foreignClass)))
    )
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/cls-abc', { method: 'DELETE' }),
      mockEnv
    )
    expect(res.status).toBe(403)
  })
})
