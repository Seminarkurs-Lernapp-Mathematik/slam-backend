/**
 * One-time script to set `role: "teacher"` custom claim on a Firebase user.
 *
 * Usage:
 *   node scripts/set-teacher-claim.mjs <USER_UID> <path/to/service-account.json>
 *
 * Find the USER_UID in Firebase Console → Authentication → Users → copy UID column.
 * The service account JSON is the same file you used for `wrangler secret put FIREBASE_SERVICE_ACCOUNT`.
 */

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const [uid, saPath] = process.argv.slice(2);

if (!uid || !saPath) {
  console.error('Usage: node scripts/set-teacher-claim.mjs <USER_UID> <path/to/service-account.json>');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(saPath, 'utf8'));

// ── 1. Mint a signed JWT for the service account ──────────────────────────────
function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = base64url(JSON.stringify({
  iss: sa.client_email,
  sub: sa.client_email,
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
  scope: 'https://www.googleapis.com/auth/firebase',
}));

const signer = createSign('RSA-SHA256');
signer.update(`${header}.${payload}`);
const signature = signer.sign(sa.private_key, 'base64url');
const jwt = `${header}.${payload}.${signature}`;

// ── 2. Exchange JWT for an OAuth2 access token ────────────────────────────────
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
});
if (!tokenRes.ok) {
  const err = await tokenRes.text();
  console.error('Failed to get admin token:', err);
  process.exit(1);
}
const { access_token } = await tokenRes.json();

// ── 3. Set the custom claim via Firebase Admin REST API ───────────────────────
const claimRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      localId: uid,
      customAttributes: JSON.stringify({ role: 'teacher' }),
    }),
  }
);
if (!claimRes.ok) {
  const err = await claimRes.text();
  console.error('Failed to set custom claim:', err);
  process.exit(1);
}

console.log(`✓ User ${uid} now has { role: "teacher" } custom claim.`);
console.log('  The user must sign out and sign back in for the new token to take effect.');
