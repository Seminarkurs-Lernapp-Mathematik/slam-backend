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

describe('GET /api/teacher/me', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  async function makeApp() {
    const { default: router } = await import('./me')
    const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
    app.use('*', async (c, next) => {
      c.set('teacherUid', 'teacher-uid-1')
      await next()
    })
    app.route('/', router)
    return app
  }

  it('returns teacher profile when doc exists', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      })))
    )
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/'), mockEnv)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.displayName).toBe('Frau Müller')
    expect(body.email).toBe('mueller@mvl-gym.de')
  })

  it('returns 404 when teacher doc does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
    )
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/'), mockEnv)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/teacher/me', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  async function makeApp() {
    const { default: router } = await import('./me')
    const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
    app.use('*', async (c, next) => {
      c.set('teacherUid', 'teacher-uid-1')
      await next()
    })
    app.route('/', router)
    return app
  }

  it('updates displayName and theme', async () => {
    vi.stubGlobal('fetch', vi.fn()
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

describe('POST /api/teacher/me', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../utils/firebaseAuth', () => ({
      getFirebaseConfig: vi.fn().mockResolvedValue({
        projectId: 'test-proj',
        accessToken: 'test-token',
      }),
    }))
  })

  async function makeApp() {
    const { default: router } = await import('./me')
    const app = new Hono<{ Bindings: Env; Variables: { teacherUid: string } }>()
    app.use('*', async (c, next) => {
      c.set('teacherUid', 'teacher-uid-1')
      await next()
    })
    app.route('/', router)
    return app
  }

  const mockNewTeacher = {
    name: 'projects/test-proj/databases/(default)/documents/teachers/teacher-uid-1',
    fields: {
      uid: { stringValue: 'teacher-uid-1' },
      displayName: { stringValue: 'Herr Müller' },
      email: { stringValue: 'mueller@mvl-gym.de' },
      schoolId: { stringValue: 'mvl' },
      classIds: { arrayValue: { values: [] } },
      theme: { stringValue: 'dark' },
      createdAt: { stringValue: '2026-04-01T00:00:00.000Z' },
    },
  }

  it('creates teacher profile and returns 201', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 })) // fsGet → not found
      .mockResolvedValueOnce(new Response(JSON.stringify(mockNewTeacher))) // fsPatch → created
    )
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Herr Müller',
          email: 'mueller@mvl-gym.de',
          theme: 'dark',
        }),
      }),
      mockEnv
    )
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.displayName).toBe('Herr Müller')
    expect(body.uid).toBe('teacher-uid-1')
  })

  it('returns 400 when displayName is missing', async () => {
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mueller@mvl-gym.de' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(400)
  })

  it('returns 409 when teacher profile already exists', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mockNewTeacher))) // fsGet → already exists
    )
    const app = await makeApp()
    const res = await app.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Herr Müller', email: 'mueller@mvl-gym.de' }),
      }),
      mockEnv
    )
    expect(res.status).toBe(409)
  })
})
