import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { createCloudApp } from '../worker/app';
import type { Bindings } from '../worker/types';

const origin = 'https://bar.example.com';
export async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: '2026-09-07',
      d1Databases: ['DB'],
    }),
  );
  try {
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    const sql = readFileSync('migrations/0001_service.sql', 'utf8');
    await db.exec(sql.replaceAll('\n', ' '));
    const drink = (id: number, kindId: number | null) => ({
      id,
      name: `材料${id}`,
      kindId,
      kindName: 'お酒',
      available: false,
      staple: false,
    });
    const cocktail = (id: number, drinkId: number) => ({
      id,
      name: `カクテル${id}`,
      description: '',
      alcohol: '10%',
      alcoholLow: 10,
      alcoholHigh: 10,
      image: '',
      glass: 'グラス',
      technique: 'ステア',
      ingredients: [
        {
          id,
          drinkId,
          name: `材料${drinkId}`,
          kindId: 1,
          quantity: '30ml',
          candidates: [],
          substitute: false,
        },
      ],
      available: false,
      substitution: false,
    });
    await db.batch([
      db.prepare("INSERT INTO catalog_versions VALUES('v1','2026-09-07')"),
      db.prepare("INSERT INTO catalog_state VALUES(1,'v1')"),
      db.prepare('INSERT INTO drinks VALUES(1),(2),(3)'),
      ...[drink(1, 1), drink(2, 1), drink(3, null)].map((d) =>
        db.prepare("INSERT INTO catalog_drinks VALUES('v1',?,?)").bind(d.id, JSON.stringify(d)),
      ),
      ...[cocktail(1, 1), cocktail(2, 2)].map((c) =>
        db.prepare("INSERT INTO catalog_entries VALUES('v1',?,?)").bind(c.id, JSON.stringify(c)),
      ),
      db.prepare("INSERT INTO catalog_kinds VALUES('v1',1,'お酒')"),
    ]);
    const env: Bindings = {
      DB: db,
      APP_ENV: 'staging',
      PUBLIC_APP_URL: origin,
      FIREBASE_PROJECT_ID: 'test-project',
    };
    const app = createCloudApp(async (token) => {
      if (!['alice', 'bob'].includes(token)) throw new Error('Invalid');
      return { uid: token, name: token };
    });
    const request = (
      path: string,
      {
        uid,
        method = 'GET',
        body,
        cookie,
        customOrigin = origin,
      }: {
        uid?: string;
        method?: string;
        body?: unknown;
        cookie?: string;
        customOrigin?: string;
      } = {},
    ) =>
      app.request(
        origin + path,
        {
          method,
          headers: {
            ...(uid ? { Authorization: `Bearer ${uid}` } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(method !== 'GET'
              ? { 'Content-Type': 'application/json', Origin: customOrigin }
              : {}),
            'CF-Connecting-IP': '192.0.2.1',
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
        env,
      );
    const bootstrap = async (uid: string) => {
      const r = await request('/api/host/bootstrap', { uid, method: 'POST', body: {} });
      assert.equal(r.status, 200);
      return ((await r.json()) as any).bar;
    };
    const invite = async (uid: string) => {
      await request('/api/host/bar', { uid, method: 'PATCH', body: { acceptingOrders: true } });
      const r = await request('/api/host/invitation', { uid });
      return ((await r.json()) as any).inviteUrl.split('/').pop() as string;
    };
    const join = async (barId: string, token: string, cookie?: string) => {
      const r = await request(`/api/b/${barId}/join`, {
        method: 'POST',
        body: { token, nickname: '同じ名前' },
        cookie,
      });
      assert.equal(r.status, 200, await r.clone().text());
      return {
        cookie: r.headers.get('Set-Cookie')!.split(';')[0],
        header: r.headers.get('Set-Cookie')!,
        guest: ((await r.json()) as any).guest,
      };
    };
    return { mf, db, env, app, request, bootstrap, invite, join };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
