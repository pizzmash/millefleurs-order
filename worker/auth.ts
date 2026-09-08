import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Identity } from './types';
const keys = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  ),
  { cacheMaxAge: 60 * 60 * 1000 },
);
export async function verifyIdentity(
  token: string,
  project: string,
  key: JWTVerifyGetKey = keys,
): Promise<Identity> {
  if (!project || project.startsWith('demo-'))
    throw new Error('Firebase project is not configured');
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${project}`,
    audience: project,
    requiredClaims: ['sub', 'exp', 'iat', 'auth_time'],
  });
  const now = Math.floor(Date.now() / 1000);
  const firebase = payload.firebase as { sign_in_provider?: string } | undefined;
  if (
    !protectedHeader.kid ||
    !payload.sub ||
    payload.sub.length > 128 ||
    typeof payload.iat !== 'number' ||
    payload.iat > now ||
    typeof payload.auth_time !== 'number' ||
    payload.auth_time > now ||
    firebase?.sign_in_provider !== 'google.com'
  )
    throw new Error('Invalid identity');
  return {
    uid: payload.sub,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 100) : '家主',
  };
}
export function publicOrigin(value: string, local = false) {
  const url = new URL(value);
  if (
    (!local && url.protocol !== 'https:') ||
    (local && !['http:', 'https:'].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (!local && ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname))
  )
    throw new Error('PUBLIC_APP_URL is invalid');
  return url.origin;
}
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export async function tokenHash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
