import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { D1Database } from '@cloudflare/workers-types';
import { publicOrigin, tokenHash, verifyIdentity } from '../worker/auth';
import { catalogSql } from '../scripts/cloud/catalog';

import { setup } from './cloud-fixture';

test('D1: two owners, scoped sessions, atomic ordering, invitation lifecycle', async () => {
  const s = await setup();
  try {
    const { request, db } = s;
    assert.equal((await request('/api/host/inventory')).status, 401);
    assert.equal(
      (await request('/api/host/bootstrap', { uid: 'fake', method: 'POST', body: {} })).status,
      401,
    );
    const [a, aAgain] = await Promise.all([s.bootstrap('alice'), s.bootstrap('alice')]);
    const b = await s.bootstrap('bob');
    assert.equal(a.id, aAgain.id);
    assert.notEqual(a.id, b.id);
    assert.equal(a.acceptingOrders, false);
    const initial = await request('/api/host/invitation', { uid: 'alice' });
    const initialToken = ((await initial.json()) as any).inviteUrl.split('/').pop();
    assert.equal(
      (
        await request(`/api/b/${a.id}/join`, {
          method: 'POST',
          body: { token: initialToken, nickname: '客人' },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request('/api/host/inventory/1', {
          uid: 'alice',
          method: 'PUT',
          body: { available: true, bar_id: b.id },
        })
      ).status,
      200,
    );
    assert.equal(
      ((await (await request('/api/host/inventory', { uid: 'bob' })).json()) as any).drinks[0]
        .available,
      false,
    );
    const at = await s.invite('alice'),
      bt = await s.invite('bob');
    const ag = await s.join(a.id, at),
      bg = await s.join(b.id, bt),
      ag2 = await s.join(a.id, at);
    assert.match(ag.header, /HttpOnly/);
    assert.match(ag.header, /Secure/);
    assert.match(ag.header, /SameSite=Lax/);
    assert.ok(ag.header.includes(`Path=/api/b/${a.id}`));
    assert.notEqual(ag.guest.id, ag2.guest.id);
    const again = await s.join(a.id, at, ag.cookie);
    assert.equal(again.guest.id, ag.guest.id);
    assert.equal((await request(`/api/b/${b.id}/orders`, { cookie: ag.cookie })).status, 401);
    assert.equal((await request('/api/menu')).status, 404);
    assert.equal((await request(`/api/b/${a.id}/menu`, { cookie: ag.cookie })).status, 200);
    assert.equal(
      ((await (await request(`/api/b/${b.id}/menu`, { cookie: bg.cookie })).json()) as any).total,
      0,
    );
    const input = { cocktailId: 1, requestKey: 'duplicate-key-123456' };
    const results = await Promise.all([
      request(`/api/b/${a.id}/orders`, { cookie: ag.cookie, method: 'POST', body: input }),
      request(`/api/b/${a.id}/orders`, { cookie: ag.cookie, method: 'POST', body: input }),
    ]);
    for (const r of results) assert.ok([200, 201].includes(r.status), await r.clone().text());
    const o1 = (await results[0].json()) as any,
      o2 = (await results[1].json()) as any;
    assert.equal(o1.id, o2.id);
    assert.equal(
      (
        await request(`/api/b/${a.id}/orders`, {
          cookie: ag.cookie,
          method: 'POST',
          body: { ...input, cocktailId: 2 },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/api/host/orders/${o1.id}/complete`, {
          uid: 'bob',
          method: 'POST',
          body: {},
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(`/api/host/orders/${o1.id}/ingredients/1`, {
          uid: 'bob',
          method: 'PUT',
          body: { drinkId: 1 },
        })
      ).status,
      404,
    );
    assert.equal(
      ((await (await request(`/api/b/${a.id}/orders`, { cookie: ag2.cookie })).json()) as any)
        .orders.length,
      0,
    );
    assert.equal(
      (
        await request(`/api/b/${a.id}/orders`, {
          cookie: ag.cookie,
          method: 'POST',
          body: { ...input, requestKey: 'csrf-request-key-123' },
          customOrigin: 'https://evil.example',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(`/api/b/${a.id}/orders`, {
          cookie: ag.cookie,
          method: 'POST',
          body: input,
          customOrigin: '',
        })
      ).status,
      403,
    );
    await request('/api/host/bar', {
      uid: 'alice',
      method: 'PATCH',
      body: { acceptingOrders: false },
    });
    assert.equal(
      (
        await request(`/api/b/${a.id}/orders`, {
          cookie: ag.cookie,
          method: 'POST',
          body: { ...input, requestKey: 'stopped-request-123' },
        })
      ).status,
      409,
    );
    assert.equal((await request(`/api/b/${a.id}/orders`, { cookie: ag.cookie })).status, 200);
    assert.equal(
      (
        await request(`/api/host/orders/${o1.id}/complete`, {
          uid: 'alice',
          method: 'POST',
          body: {},
        })
      ).status,
      200,
    );
    await request('/api/host/invitation/rotate', { uid: 'alice', method: 'POST', body: {} });
    assert.equal(
      (await request('/api/invitations/resolve', { method: 'POST', body: { token: at } })).status,
      404,
    );
    assert.equal((await request(`/api/b/${a.id}/orders`, { cookie: ag.cookie })).status, 401);
    assert.equal((await request(`/api/b/${b.id}/session`, { cookie: bg.cookie })).status, 200);
    assert.equal(
      (await db
        .prepare('SELECT COUNT(*) AS n FROM orders WHERE bar_id=?')
        .bind(a.id)
        .first<{ n: number }>())!.n,
      1,
    );
    await db.prepare('UPDATE guest_sessions SET expires_at=0 WHERE bar_id=?').bind(b.id).run();
    assert.equal((await request(`/api/b/${b.id}/orders`, { cookie: bg.cookie })).status, 401);
    await db.prepare("UPDATE users SET status='disabled' WHERE firebase_uid='bob'").run();
    assert.equal((await request('/api/host/inventory', { uid: 'bob' })).status, 403);
    assert.equal(
      (await request('/api/invitations/resolve', { method: 'POST', body: { token: bt } })).status,
      404,
    );
    await assert.rejects(
      db
        .prepare("INSERT INTO guest_sessions VALUES('bad',?,?,1,9999999999999)")
        .bind(b.id, ag.guest.id)
        .run(),
    );
  } finally {
    await s.mf.dispose();
  }
});

test('D1: substitution, distributed rate limit and version conflict', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    const token = await s.invite('alice');
    const g = await s.join(a.id, token);
    await s.request('/api/host/inventory/2', {
      uid: 'alice',
      method: 'PUT',
      body: { available: true },
    });
    const response = await s.request(`/api/b/${a.id}/orders`, {
      cookie: g.cookie,
      method: 'POST',
      body: { cocktailId: 1, requestKey: 'substitution-key-123' },
    });
    assert.equal(response.status, 201, await response.clone().text());
    const o = (await response.json()) as any;
    assert.equal(o.ingredients[0].selectedId, null);
    assert.equal(
      (
        await s.request(`/api/host/orders/${o.id}/complete`, {
          uid: 'alice',
          method: 'POST',
          body: {},
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await s.request(`/api/host/orders/${o.id}/ingredients/1`, {
          uid: 'alice',
          method: 'PUT',
          body: { drinkId: 2 },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await s.request(`/api/host/orders/${o.id}/complete`, {
          uid: 'alice',
          method: 'POST',
          body: {},
        })
      ).status,
      200,
    );
    // Interleave a version change after the API snapshot but before its conditional INSERT.
    const db = s.env.DB;
    const interleaved = {
      prepare(sql: string) {
        if (sql.startsWith('INSERT INTO orders('))
          return {
            bind(...values: unknown[]) {
              return {
                async run() {
                  await db
                    .prepare('UPDATE bars SET inventory_version=inventory_version+1 WHERE id=?')
                    .bind(a.id)
                    .run();
                  return db
                    .prepare(sql)
                    .bind(...values)
                    .run();
                },
              };
            },
          };
        return db.prepare(sql);
      },
      batch: db.batch.bind(db),
    } as unknown as D1Database;
    s.env.DB = interleaved;
    assert.equal(
      (
        await s.request(`/api/b/${a.id}/orders`, {
          cookie: g.cookie,
          method: 'POST',
          body: { cocktailId: 1, requestKey: 'version-conflict-123' },
        })
      ).status,
      409,
    );
    s.env.DB = db;
    await db
      .prepare(
        'INSERT INTO rate_limits VALUES(?,?,20) ON CONFLICT(key) DO UPDATE SET count=20,window=excluded.window',
      )
      .bind(await tokenHash(`order:${g.guest.id}`), Math.floor(Date.now() / 60000))
      .run();
    const limited = await s.request(`/api/b/${a.id}/orders`, {
      cookie: g.cookie,
      method: 'POST',
      body: { cocktailId: 1, requestKey: 'rate-request-12345' },
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('Retry-After'));
  } finally {
    await s.mf.dispose();
  }
});

test('Firebase verification checks signatures, project, expiration and provider', async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims: Record<string, unknown> = {}) =>
    new SignJWT({
      sub: 'alice',
      aud: 'project',
      iss: 'https://securetoken.google.com/project',
      iat: now,
      exp: now + 3600,
      auth_time: now,
      firebase: { sign_in_provider: 'google.com' },
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .sign(pair.privateKey);
  assert.equal((await verifyIdentity(await sign(), 'project', keys)).uid, 'alice');
  for (const claims of [
    { aud: 'other' },
    { iss: 'bad' },
    { exp: now - 1 },
    { iat: now + 10 },
    { auth_time: now + 10 },
    { sub: '' },
    { firebase: { sign_in_provider: 'password' } },
  ])
    await assert.rejects(verifyIdentity(await sign(claims), 'project', keys));
  await assert.rejects(verifyIdentity('not-a-jwt', 'project', keys));
  const other = await generateKeyPair('RS256', { extractable: true });
  const badKeys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(other.publicKey)), kid: 'test', alg: 'RS256' }],
  });
  await assert.rejects(verifyIdentity(await sign(), 'project', badKeys));
});

test('public URL is canonical and fails closed', () => {
  assert.equal(publicOrigin('https://bar.example.com/'), 'https://bar.example.com');
  assert.equal(publicOrigin('http://localhost:5173', true), 'http://localhost:5173');
  for (const value of [
    '',
    'http://bar.example.com',
    'https://localhost',
    'https://bar.example.com/path',
    'https://bar.example.com?x=1',
    'https://user:pw@bar.example.com',
    'https://bar.example.com/#x',
  ])
    assert.throws(() => publicOrigin(value));
});

test('real CSV catalog stages separately and can be re-imported without data loss', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    await s.request('/api/host/inventory/1', {
      uid: 'alice',
      method: 'PUT',
      body: { available: true },
    });
    const data = catalogSql();
    assert.ok(data.counts.cocktails > 900);
    for (let i = 0; i < data.rows.length; i += 50)
      await s.db.batch(data.rows.slice(i, i + 50).map((sql) => s.db.prepare(sql)));
    assert.equal(
      (await s.db.prepare('SELECT version FROM catalog_state').first<{ version: string }>())!
        .version,
      'v1',
    );
    await s.db.prepare(data.activate).run();
    const inventory = await s.request('/api/host/inventory', { uid: 'alice' });
    assert.equal(inventory.status, 200);
    const value = (await inventory.json()) as any;
    assert.ok(value.drinks.find((d: any) => d.id === 1).available);
    assert.equal(value.drinks.filter((d: any) => d.staple).length, 2);
    assert.equal(
      (await s.db.prepare('SELECT id FROM bars WHERE id=?').bind(a.id).first())!.id,
      a.id,
    );
  } finally {
    await s.mf.dispose();
  }
});
