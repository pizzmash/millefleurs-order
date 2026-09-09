import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions, Response as MfResponse } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { catalogSql } from '../scripts/cloud/catalog';
const origin = 'https://bar.example.com';
const pair = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'runtime-test', alg: 'RS256' };
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'pages',
        modules: true,
        scriptPath: '.runtime/pages-build/index.js',
        compatibilityDate: '2026-09-07',
        serviceBindings: { API: 'api' },
      },
      {
        name: 'api',
        modules: true,
        scriptPath: '.runtime/worker-build/index.js',
        compatibilityDate: '2026-09-07',
        d1Databases: ['DB'],
        bindings: {
          APP_ENV: 'staging',
          PUBLIC_APP_URL: origin,
          FIREBASE_PROJECT_ID: 'runtime-project',
        },
        outboundService: (request) => {
          assert.equal(new URL(request.url).origin, 'https://www.googleapis.com');
          return new MfResponse(JSON.stringify({ keys: [jwk] }), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        },
      },
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'api');
  await db.exec(readFileSync('migrations/0001_service.sql', 'utf8').replaceAll('\n', ' '));
  assert.equal((await mf.dispatchFetch(origin + '/api/health')).status, 200);
  assert.equal((await mf.dispatchFetch(origin + '/api/host/bar')).status, 401);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: 'runtime-owner',
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: 'google.com' },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'runtime-test' })
    .setAudience('runtime-project')
    .setIssuer('https://securetoken.google.com/runtime-project')
    .sign(pair.privateKey);
  const headers = {
    Origin: origin,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const bootstrap = await mf.dispatchFetch(origin + '/api/host/bootstrap', {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(bootstrap.status, 200, await bootstrap.clone().text());
  const b = ((await bootstrap.json()) as any).bar;
  await mf.dispatchFetch(origin + '/api/host/bar', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ acceptingOrders: true }),
  });
  const invite = await mf.dispatchFetch(origin + '/api/host/invitation', { headers });
  assert.equal(invite.status, 200);
  const url = ((await invite.json()) as any).inviteUrl;
  const join = await mf.dispatchFetch(origin + `/api/b/${b.id}/join`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: url.split('/').pop(), nickname: 'runtime-guest' }),
  });
  assert.equal(join.status, 200, await join.clone().text());
  const cookie = join.headers.get('Set-Cookie')!;
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  const session = await mf.dispatchFetch(origin + `/api/b/${b.id}/session`, {
    headers: { Cookie: cookie.split(';')[0] },
  });
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('Cache-Control'), 'no-store');
  const catalog = catalogSql();
  for (let i = 0; i < catalog.rows.length; i += 50)
    await db.batch(catalog.rows.slice(i, i + 50).map((sql) => db.prepare(sql)));
  await db.prepare(catalog.activate).run();
  // Exercise module-level cached data across separate workerd request contexts.
  for (const available of [true, false, true]) {
    const update = await mf.dispatchFetch(origin + '/api/host/inventory/1', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ available }),
    });
    assert.equal(update.status, 200, await update.clone().text());
    const inventory = await mf.dispatchFetch(origin + '/api/host/inventory', { headers });
    assert.equal(inventory.status, 200, await inventory.clone().text());
    assert.equal(
      ((await inventory.json()) as any).drinks.find((d: any) => d.id === 1).available,
      available,
    );
    const menu = await mf.dispatchFetch(origin + `/api/b/${b.id}/menu`, {
      headers: { Cookie: cookie.split(';')[0] },
    });
    assert.equal(menu.status, 200, await menu.clone().text());
  }
  console.log(
    'Built Pages → Service binding → built Worker → D1: signed Firebase token, bootstrap, invitation, cookie round trip passed.',
  );
} finally {
  await mf.dispose();
}
