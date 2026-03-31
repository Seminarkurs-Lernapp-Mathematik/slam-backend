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
