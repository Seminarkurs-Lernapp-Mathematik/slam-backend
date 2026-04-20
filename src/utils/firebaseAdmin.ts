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
    scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/identitytoolkit',
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
 * Set a custom claim on a Firebase user via the Admin REST API.
 */
export async function setCustomClaim(env: Env, uid: string, claims: Record<string, unknown>): Promise<void> {
  const sa: ServiceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const adminToken = await getAdminToken(sa);

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }),
    }
  );
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err?.error?.message ?? `Failed to set custom claim: ${res.status}`);
  }
}

/**
 * Look up an existing Firebase Auth user by email.
 * Returns the user's UID.
 */
export async function getUserByEmail(env: Env, email: string): Promise<string> {
  const sa: ServiceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const adminToken = await getAdminToken(sa);

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: [email] }),
    }
  );
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err?.error?.message ?? `Failed to look up user: ${res.status}`);
  }
  const data = await res.json() as { users?: Array<{ localId: string }> };
  const user = data.users?.[0];
  if (!user) throw new Error(`User not found for email: ${email}`);
  return user.localId;
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
