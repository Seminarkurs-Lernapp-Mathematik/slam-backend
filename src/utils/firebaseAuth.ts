/**
 * Server-side Firebase Authentication
 * Generates OAuth2 access tokens from service account credentials
 * using the Web Crypto API (compatible with Cloudflare Workers)
 */

import type { Env } from '../index';

interface ServiceAccount {
  project_id: string;
  private_key?: string;
  client_email?: string;
}

interface FirebaseConfig {
  projectId: string;
  accessToken: string;
}

// Cache the access token to avoid re-signing on every request
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Base64url encode a buffer
 */
function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url encode a string
 */
function base64urlEncodeString(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Import a PEM private key for signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and decode
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const binaryString = atob(pemBody);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Create a signed JWT for Google OAuth2
 */
async function createSignedJWT(serviceAccount: Required<ServiceAccount>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(serviceAccount.private_key);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput)
  );

  const signatureB64 = base64urlEncode(signature);
  return `${signingInput}.${signatureB64}`;
}

/**
 * Exchange a signed JWT for an OAuth2 access token
 */
async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const hasFullCredentials = !!(serviceAccount.private_key && serviceAccount.client_email);

  // Check cache only when full credentials are present (skip cache in test/minimal mode)
  if (hasFullCredentials && cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const body = hasFullCredentials
    ? `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${await createSignedJWT(serviceAccount as Required<ServiceAccount>)}`
    : `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to get Firebase access token: ${response.status}`);
  }

  const data: any = await response.json();
  const token = data.access_token;
  const expiresIn = data.expires_in || 3600;

  // Cache the token only when using full credentials
  if (hasFullCredentials) {
    cachedToken = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  return token;
}

/**
 * Get Firebase config from either the request body or server-side credentials.
 * Prefers request-provided config, falls back to FIREBASE_SERVICE_ACCOUNT env var.
 */
export async function getFirebaseConfig(
  env: Env,
  requestConfig?: { projectId?: string; accessToken?: string }
): Promise<FirebaseConfig> {
  // Use request-provided config if complete
  if (requestConfig?.projectId && requestConfig?.accessToken) {
    return {
      projectId: requestConfig.projectId,
      accessToken: requestConfig.accessToken,
    };
  }

  // Fall back to server-side service account
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error(
      'Firebase authentication required: provide firebaseConfig in request or set FIREBASE_SERVICE_ACCOUNT secret'
    );
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT format');
  }

  if (!serviceAccount.project_id) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT missing required fields');
  }

  const accessToken = await getAccessToken(serviceAccount);

  return {
    projectId: serviceAccount.project_id,
    accessToken,
  };
}
