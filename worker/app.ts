import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Bar, Env, Identity, Session } from './types';
import type { Drink, Order, OrderIngredient } from '../shared/types';
import { candidates } from '../shared/catalog';
import { catalog, menu } from './catalog';
import { publicOrigin, randomToken, tokenHash, verifyIdentity } from './auth';

type DbOrder = {
  id: string;
  bar_id: string;
  guest_id: string;
  nickname: string;
  cocktail_id: number;
  cocktail_name: string;
  image: string;
  technique: string;
  glass: string;
  status: Order['status'];
  created_at: string;
  completed_at: string | null;
  request_key: string;
  ingredients: string;
  revision: number;
};
const fail = (status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string): never => {
  throw new HTTPException(status, { message });
};
const integer = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    fail(400, '数値の指定を確認してください。');
  return v as number;
};
async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  if (c.req.header('Content-Type')?.split(';')[0].trim() !== 'application/json')
    return fail(400, 'JSON形式で送信してください。');
  const value = await c.req.json().catch(() => null);
  if (!value || Array.isArray(value) || typeof value !== 'object')
    return fail(400, '入力を確認してください。');
  return value;
}
const presentBar = (b: Bar) => ({
  id: b.id,
  name: b.name,
  acceptingOrders: !!b.accepting_orders,
  inventoryVersion: b.inventory_version,
});
function present(o: DbOrder, drinks: Drink[]): Order {
  return {
    id: o.id,
    nickname: o.nickname,
    cocktailId: o.cocktail_id,
    cocktailName: o.cocktail_name,
    image: o.image,
    technique: o.technique,
    glass: o.glass,
    status: o.status,
    createdAt: o.created_at,
    completedAt: o.completed_at,
    ingredients: (JSON.parse(o.ingredients) as OrderIngredient[]).map((i) => {
      const options = candidates(
        i.drinkId,
        drinks.find((d) => d.id === i.drinkId)?.kindId ?? i.kindId,
        drinks,
      );
      return {
        ...i,
        candidates: options,
        missing:
          o.status === 'pending' &&
          (i.selectedId === null
            ? !options.length
            : !drinks.some((d) => d.id === i.selectedId && d.available)),
      };
    }),
  };
}
async function rate(c: Context<Env>, key: string, limit: number) {
  const window = Math.floor(Date.now() / 60_000);
  const r = await c.env.DB.prepare(
    'INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN rate_limits.window=excluded.window THEN MIN(rate_limits.count+1,1000000) ELSE 1 END RETURNING count',
  )
    .bind(await tokenHash(key), window)
    .first<{ count: number }>();
  if (r!.count > limit) {
    c.header('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
    fail(429, '操作が多いため、少し待って再試行してください。');
  }
}
async function session(c: Context<Env>, barId: string): Promise<Session | null> {
  const token = getCookie(c, 'bar_guest');
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
  return c.env.DB.prepare(
    `SELECT s.*,g.nickname FROM guest_sessions s JOIN guests g ON g.id=s.guest_id AND g.bar_id=s.bar_id JOIN bars b ON b.id=s.bar_id JOIN users u ON u.firebase_uid=b.owner_uid WHERE s.token_hash=? AND s.bar_id=? AND s.expires_at>? AND s.invite_version=b.invite_version AND u.status='active'`,
  )
    .bind(await tokenHash(token), barId, Date.now())
    .first<Session>();
}
async function bar(c: Context<Env>, id: string) {
  return c.env.DB.prepare('SELECT * FROM bars WHERE id=?').bind(id).first<Bar>();
}
async function order(c: Context<Env>, id: string) {
  return c.env.DB.prepare('SELECT * FROM orders WHERE bar_id=? AND id=?')
    .bind(c.get('bar').id, id)
    .first<DbOrder>();
}

export function createCloudApp(
  verify: (token: string, project: string) => Promise<Identity> = verifyIdentity,
) {
  const app = new Hono<Env>();
  app.use('/api/*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('X-Request-Id', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: '送信内容が大きすぎます。' }, 413),
    }),
  );
  app.onError((e, c) => {
    if (e instanceof HTTPException) return c.json({ error: e.message }, e.status);
    console.error(JSON.stringify({ requestId: c.get('requestId'), event: 'api_failure' }));
    return c.json({ error: '処理できませんでした。時間をおいて再試行してください。' }, 503);
  });
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.use('/api/*', async (c, next) => {
    const origin = publicOrigin(c.env.PUBLIC_APP_URL, c.env.APP_ENV === 'local');
    if (!['GET', 'HEAD'].includes(c.req.method) && c.req.header('Origin') !== origin)
      return c.json({ error: 'この画面から操作してください。' }, 403);
    await next();
  });
  app.use('/api/host/*', async (c, next) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) return fail(401, 'Googleでログインしてください。');
    let identity: Identity;
    try {
      identity = await verify(auth.slice(7), c.env.FIREBASE_PROJECT_ID);
    } catch {
      return fail(401, 'ログインの有効期限を確認してください。');
    }
    c.set('identity', identity);
    const user = await c.env.DB.prepare('SELECT status FROM users WHERE firebase_uid=?')
      .bind(identity.uid)
      .first<{ status: string }>();
    if (user?.status === 'disabled') return fail(403, 'このアカウントは停止されています。');
    await rate(c, `host:${identity.uid}`, 240);
    if (c.req.path !== '/api/host/bootstrap') {
      const b = await c.env.DB.prepare('SELECT * FROM bars WHERE owner_uid=?')
        .bind(identity.uid)
        .first<Bar>();
      if (!b) return fail(409, '初期登録を完了してください。');
      c.set('bar', b);
    }
    await next();
  });
  app.post('/api/host/bootstrap', async (c) => {
    await body(c);
    const i = c.get('identity');
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users(firebase_uid,display_name,created_at) VALUES(?,?,?) ON CONFLICT(firebase_uid) DO NOTHING',
      ).bind(i.uid, i.name, new Date().toISOString()),
      c.env.DB.prepare(
        "INSERT INTO bars(id,owner_uid,invite_token) SELECT ?,firebase_uid,? FROM users WHERE firebase_uid=? AND status='active' ON CONFLICT(owner_uid) DO NOTHING",
      ).bind(crypto.randomUUID(), randomToken(), i.uid),
    ]);
    const b = await c.env.DB.prepare(
      "SELECT b.* FROM bars b JOIN users u ON u.firebase_uid=b.owner_uid WHERE b.owner_uid=? AND u.status='active'",
    )
      .bind(i.uid)
      .first<Bar>();
    if (!b) return fail(403, 'このアカウントは停止されています。');
    return c.json({ bar: presentBar(b) });
  });
  app.get('/api/host/bar', (c) => c.json(presentBar(c.get('bar'))));
  app.patch('/api/host/bar', async (c) => {
    const v = await body(c);
    const b = c.get('bar');
    if (
      v.name !== undefined &&
      (typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 60)
    )
      return fail(400, 'バー名は1〜60文字で入力してください。');
    if (v.acceptingOrders !== undefined && typeof v.acceptingOrders !== 'boolean')
      return fail(400, '受付状態を確認してください。');
    await c.env.DB.prepare(
      'UPDATE bars SET name=COALESCE(?,name),accepting_orders=COALESCE(?,accepting_orders) WHERE id=?',
    )
      .bind(
        typeof v.name === 'string' ? v.name.trim() : null,
        typeof v.acceptingOrders === 'boolean' ? +v.acceptingOrders : null,
        b.id,
      )
      .run();
    return c.json(presentBar((await bar(c, b.id))!));
  });
  app.get('/api/host/invitation', (c) =>
    c.json({
      inviteUrl: new URL(
        `/join/${c.get('bar').invite_token}`,
        publicOrigin(c.env.PUBLIC_APP_URL, c.env.APP_ENV === 'local'),
      ).href,
      ...presentBar(c.get('bar')),
    }),
  );
  app.post('/api/host/invitation/rotate', async (c) => {
    await body(c);
    const b = c.get('bar');
    await c.env.DB.prepare(
      'UPDATE bars SET invite_token=?,invite_version=invite_version+1 WHERE id=?',
    )
      .bind(randomToken(), b.id)
      .run();
    return c.json({ ok: true });
  });
  app.get('/api/host/inventory', async (c) => {
    const d = await catalog(c.env.DB, c.get('bar').id);
    return c.json({
      drinks: d.drinks,
      availableCount: d.cocktails.filter((x) => x.available).length,
      inventoryVersion: c.get('bar').inventory_version,
      catalogVersion: d.catalogVersion,
    });
  });
  app.put('/api/host/inventory/:id', async (c) => {
    const id = integer(Number(c.req.param('id')));
    const v = await body(c);
    if (typeof v.available !== 'boolean') return fail(400, '在庫の指定を確認してください。');
    const d = (await catalog(c.env.DB, c.get('bar').id)).drinks.find((d) => d.id === id);
    if (!d) return fail(404, '材料が見つかりません。');
    if (d.staple) return fail(400, '水と氷は常備品です。');
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO inventory VALUES(?,?,?) ON CONFLICT(bar_id,drink_id) DO UPDATE SET available=excluded.available',
      ).bind(c.get('bar').id, id, +v.available),
      c.env.DB.prepare('UPDATE bars SET inventory_version=inventory_version+1 WHERE id=?').bind(
        c.get('bar').id,
      ),
    ]);
    return c.json({ ok: true });
  });
  app.get('/api/host/purchase-input', async (c) => {
    const b = c.get('bar');
    const d = await catalog(c.env.DB, b.id);
    return c.json({ ...d, inventoryVersion: b.inventory_version });
  });
  app.get('/api/host/versions', async (c) => {
    const s = await c.env.DB.prepare('SELECT version FROM catalog_state WHERE id=1').first<{
      version: string;
    }>();
    return c.json({ inventoryVersion: c.get('bar').inventory_version, catalogVersion: s?.version });
  });
  app.get('/api/host/orders', async (c) => {
    const status = c.req.query('status') === 'completed' ? 'completed' : 'pending';
    const page = integer(Number(c.req.query('page') || 1));
    if (page < 1 || page > 1000000) return fail(400, 'ページ番号を確認してください。');
    const rows = await c.env.DB.prepare(
      `SELECT * FROM orders WHERE bar_id=? AND status=? ORDER BY created_at ${status === 'pending' ? 'ASC' : 'DESC'},id LIMIT 31 OFFSET ?`,
    )
      .bind(c.get('bar').id, status, (page - 1) * 30)
      .all<DbOrder>();
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM orders WHERE bar_id=? AND status='pending'",
    )
      .bind(c.get('bar').id)
      .first<{ n: number }>();
    const d = await catalog(c.env.DB, c.get('bar').id);
    return c.json({
      orders: rows.results.slice(0, 30).map((o) => present(o, d.drinks)),
      more: rows.results.length > 30,
      pendingCount: count!.n,
    });
  });
  app.put('/api/host/orders/:id/ingredients/:recipeId', async (c) => {
    const selectedId = integer((await body(c)).drinkId);
    const o = await order(c, c.req.param('id'));
    if (!o) return fail(404, '注文が見つかりません。');
    if (o.status === 'completed') return fail(409, '提供完了した注文は変更できません。');
    const ingredients = JSON.parse(o.ingredients) as OrderIngredient[];
    const i = ingredients.find((i) => i.recipeId === Number(c.req.param('recipeId')));
    if (!i) return fail(404, '材料が見つかりません。');
    const d = await catalog(c.env.DB, c.get('bar').id);
    const selected = candidates(
      i.drinkId,
      d.drinks.find((x) => x.id === i.drinkId)?.kindId ?? i.kindId,
      d.drinks,
    ).find((x) => x.id === selectedId);
    if (!selected) return fail(409, '在庫が変わりました。使える材料を選び直してください。');
    i.selectedId = selected.id;
    i.selectedName = selected.name;
    const r = await c.env.DB.prepare(
      "UPDATE orders SET ingredients=?,revision=revision+1 WHERE bar_id=? AND id=? AND revision=? AND status='pending' AND EXISTS(SELECT 1 FROM bars WHERE id=? AND inventory_version=?) AND EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND version=?)",
    )
      .bind(
        JSON.stringify(ingredients),
        o.bar_id,
        o.id,
        o.revision,
        o.bar_id,
        c.get('bar').inventory_version,
        d.catalogVersion,
      )
      .run();
    if (!r.meta.changes) return fail(409, '注文または在庫が変わりました。再読み込みしてください。');
    return c.json(present((await order(c, o.id))!, d.drinks));
  });
  app.post('/api/host/orders/:id/complete', async (c) => {
    await body(c);
    const o = await order(c, c.req.param('id'));
    if (!o) return fail(404, '注文が見つかりません。');
    if (o.status !== 'completed') {
      if ((JSON.parse(o.ingredients) as OrderIngredient[]).some((i) => i.selectedId === null))
        return fail(409, '使用した代用品を選んでください。');
      const r = await c.env.DB.prepare(
        "UPDATE orders SET status='completed',completed_at=?,revision=revision+1 WHERE bar_id=? AND id=? AND revision=? AND status='pending'",
      )
        .bind(new Date().toISOString(), o.bar_id, o.id, o.revision)
        .run();
      if (!r.meta.changes) return fail(409, '注文が変わりました。再読み込みしてください。');
    }
    return c.json(present((await order(c, o.id))!, (await catalog(c.env.DB, o.bar_id)).drinks));
  });
  async function invitation(c: Context<Env>, token: unknown) {
    await rate(c, `invite-ip:${c.req.header('CF-Connecting-IP') || 'local'}`, 120);
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token))
      return fail(404, '招待リンクが無効です。');
    const b = await c.env.DB.prepare(
      "SELECT b.* FROM bars b JOIN users u ON u.firebase_uid=b.owner_uid WHERE b.invite_token=? AND u.status='active'",
    )
      .bind(token)
      .first<Bar>();
    if (!b) return fail(404, '招待リンクが無効です。');
    return b;
  }
  app.post('/api/invitations/resolve', async (c) => {
    const b = await invitation(c, (await body(c)).token);
    return c.json({ bar: presentBar(b) });
  });
  app.post('/api/b/:barId/join', async (c) => {
    const v = await body(c);
    const b = await invitation(c, v.token);
    if (b.id !== c.req.param('barId')) return fail(404, '招待リンクが無効です。');
    if (!b.accepting_orders) return fail(409, 'ただいま注文の受付を停止しています。');
    if (typeof v.nickname !== 'string' || !v.nickname.trim() || v.nickname.trim().length > 24)
      return fail(400, 'ニックネームは1〜24文字で入力してください。');
    await rate(c, `join:${b.id}`, 120);
    const previous = await session(c, b.id);
    const id = previous?.guest_id || crypto.randomUUID();
    const token = randomToken();
    const nickname = v.nickname.trim();
    const hash = await tokenHash(token);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO guests(id,bar_id,nickname,created_at) SELECT ?,id,?,? FROM bars WHERE id=? AND accepting_orders=1 AND invite_token=? AND invite_version=? AND EXISTS(SELECT 1 FROM users WHERE firebase_uid=bars.owner_uid AND status='active') ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname",
      ).bind(id, nickname, new Date().toISOString(), b.id, b.invite_token, b.invite_version),
      c.env.DB.prepare(
        "INSERT INTO guest_sessions SELECT ?,b.id,?,b.invite_version,? FROM bars b JOIN guests g ON g.bar_id=b.id AND g.id=? JOIN users u ON u.firebase_uid=b.owner_uid WHERE b.id=? AND b.accepting_orders=1 AND b.invite_token=? AND b.invite_version=? AND u.status='active'",
      ).bind(hash, id, Date.now() + 30 * 86400000, id, b.id, b.invite_token, b.invite_version),
    ]);
    if (
      !(await c.env.DB.prepare('SELECT 1 FROM guest_sessions WHERE token_hash=?')
        .bind(hash)
        .first())
    )
      return fail(409, '招待または受付状態が変わりました。');
    setCookie(c, 'bar_guest', token, {
      httpOnly: true,
      secure: c.env.APP_ENV !== 'local' || c.env.PUBLIC_APP_URL.startsWith('https:'),
      sameSite: 'Lax',
      path: `/api/b/${b.id}`,
      maxAge: 30 * 86400,
    });
    return c.json({ guest: { id, nickname }, bar: presentBar(b) });
  });
  app.use('/api/b/:barId/*', async (c, next) => {
    const s = await session(c, c.req.param('barId')!);
    if (!s) return fail(401, '招待QRから参加し直してください。');
    c.set('guest', s);
    const b = await bar(c, s.bar_id);
    c.set('bar', b!);
    await next();
  });
  app.get('/api/b/:barId/session', (c) =>
    c.json({
      guest: { id: c.get('guest').guest_id, nickname: c.get('guest').nickname },
      bar: presentBar(c.get('bar')),
    }),
  );
  app.get('/api/b/:barId/menu', async (c) => {
    const q = new URL(c.req.url).searchParams;
    for (const key of ['min', 'max', 'kind', 'page']) {
      const v = q.get(key);
      if (
        v &&
        (!Number.isFinite(Number(v)) ||
          Number(v) < 0 ||
          (['kind', 'page'].includes(key) && !Number.isInteger(Number(v))))
      )
        return fail(400, '絞り込み条件を確認してください。');
    }
    if (q.get('min') && q.get('max') && Number(q.get('min')) > Number(q.get('max')))
      return fail(400, '度数の下限は上限以下にしてください。');
    return c.json(menu(await catalog(c.env.DB, c.get('bar').id), q));
  });
  app.get('/api/b/:barId/cocktails/:id', async (c) => {
    const cocktail = (await catalog(c.env.DB, c.get('bar').id)).cocktails.find(
      (x) => x.id === Number(c.req.param('id')),
    );
    if (!cocktail) return fail(404, 'カクテルが見つかりません。');
    return c.json(cocktail);
  });
  app.get('/api/b/:barId/orders', async (c) => {
    const page = integer(Number(c.req.query('page') || 1));
    if (page < 1 || page > 1000000) return fail(400, 'ページ番号を確認してください。');
    const rows = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE bar_id=? AND guest_id=? ORDER BY created_at DESC,id LIMIT 31 OFFSET ?',
    )
      .bind(c.get('bar').id, c.get('guest').guest_id, (page - 1) * 30)
      .all<DbOrder>();
    const d = await catalog(c.env.DB, c.get('bar').id);
    return c.json({
      orders: rows.results.slice(0, 30).map((o) => present(o, d.drinks)),
      more: rows.results.length > 30,
    });
  });
  app.post('/api/b/:barId/orders', async (c) => {
    const v = await body(c);
    const cocktailId = integer(v.cocktailId);
    if (typeof v.requestKey !== 'string' || !/^[\w-]{16,100}$/.test(v.requestKey))
      return fail(400, '注文の送信情報を確認してください。');
    const b = c.get('bar'),
      g = c.get('guest');
    await rate(c, `order:${g.guest_id}`, 20);
    const previous = () =>
      c.env.DB.prepare('SELECT * FROM orders WHERE bar_id=? AND guest_id=? AND request_key=?')
        .bind(b.id, g.guest_id, v.requestKey as string)
        .first<DbOrder>();
    const prior = await previous();
    const d = await catalog(c.env.DB, b.id);
    if (prior) {
      if (prior.cocktail_id !== cocktailId)
        return fail(409, '別の注文としてもう一度操作してください。');
      return c.json(present(prior, d.drinks));
    }
    if (!b.accepting_orders) return fail(409, 'ただいま注文の受付を停止しています。');
    const cocktail = d.cocktails.find((x) => x.id === cocktailId);
    if (!cocktail) return fail(404, 'カクテルが見つかりません。');
    if (!cocktail.available)
      return fail(409, '在庫が変わったため、現在このカクテルは注文できません。');
    const ingredients: OrderIngredient[] = cocktail.ingredients.map((i) => ({
      recipeId: i.id,
      drinkId: i.drinkId,
      name: i.name,
      kindId: i.kindId,
      quantity: i.quantity,
      selectedId: i.substitute ? null : i.drinkId,
      selectedName: i.substitute ? null : i.name,
    }));
    await c.env.DB.prepare(
      `INSERT INTO orders(id,bar_id,guest_id,nickname,cocktail_id,cocktail_name,image,technique,glass,status,created_at,completed_at,request_key,ingredients)
   SELECT ?,b.id,?,?,?,?,?,?,?,'pending',?,NULL,?,? FROM bars b JOIN users u ON u.firebase_uid=b.owner_uid
   WHERE b.id=? AND b.inventory_version=? AND b.accepting_orders=1 AND u.status='active' AND EXISTS(SELECT 1 FROM catalog_state WHERE id=1 AND version=?)
   AND EXISTS(SELECT 1 FROM guest_sessions s WHERE s.token_hash=? AND s.bar_id=b.id AND s.invite_version=b.invite_version AND s.expires_at>?)
   ON CONFLICT(bar_id,guest_id,request_key) DO NOTHING`,
    )
      .bind(
        crypto.randomUUID(),
        g.guest_id,
        g.nickname,
        cocktailId,
        cocktail.name,
        cocktail.image,
        cocktail.technique,
        cocktail.glass,
        new Date().toISOString(),
        v.requestKey,
        JSON.stringify(ingredients),
        b.id,
        b.inventory_version,
        d.catalogVersion,
        g.token_hash,
        Date.now(),
      )
      .run();
    const result = await previous();
    if (!result) return fail(409, '在庫・招待・受付状態が変わりました。再読み込みしてください。');
    if (result.cocktail_id !== cocktailId)
      return fail(409, '別の注文としてもう一度操作してください。');
    return c.json(present(result, d.drinks), 201);
  });
  app.all('/api/*', (c) => c.json({ error: '操作が見つかりません。' }, 404));
  return app;
}
export default createCloudApp();
