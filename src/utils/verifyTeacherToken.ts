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
