import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { candidates, getCatalog, getDrinks, getMenu, STAPLES } from './catalog.ts';
import { transaction } from './db.ts';
import type { Guest, Order, OrderIngredient } from '../shared/types.ts';
type Env = { Variables: { guest: Guest | null } };
type DbOrder = { id: string; guest_id: string; nickname: string; cocktail_id: number; cocktail_name: string; image: string; technique: string; glass: string; status: Order['status']; created_at: string; completed_at: string | null; request_key: string; ingredients: string };
class ApiError extends Error { constructor(public status: 400 | 401 | 404 | 409, message: string) { super(message); } }
const fail = (status: ApiError['status'], message: string): never => { throw new ApiError(status, message); };
const integer = (value: unknown) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(400, '材料またはカクテルの指定が正しくありません。'); return value as number; };
const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(400, 'JSON形式で送信してください。');
  try { const body = await request.json(); if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, '入力を確認してください。'); return body; }
  catch { return fail(400, '入力を確認してください。'); }
};
const pageNumber = (value: string | undefined) => {
  const page = value ? Number(value) : 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) return fail(400, 'ページ番号を確認してください。');
  return page;
};
export function createApp(db: DatabaseSync, options: { publicUrl?: string } = {}) {
  const app = new Hono<Env>();
  app.use('/api/*', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: '送信内容が大きすぎます。' }, 413) }));
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      // Vite preserves the browser Host while proxying API requests.
      if (origin && new URL(origin).host !== c.req.header('Host') && origin !== new URL(c.req.url).origin) return c.json({ error: 'この画面から操作してください。' }, 403);
    }
    const token = getCookie(c, 'bar_guest');
    c.set('guest', token ? (db.prepare('SELECT id,nickname FROM guests WHERE id=?').get(token) as Guest | undefined) || null : null);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: '処理できませんでした。時間をおいて再試行してください。' }, 500);
  });
  const findOrder = (id: string) => db.prepare('SELECT * FROM orders WHERE id=?').get(id) as DbOrder | undefined;
  const present = (row: DbOrder): Order => {
    const drinks = getDrinks(db);
    const ingredients = JSON.parse(row.ingredients) as OrderIngredient[];
    return { id: row.id, nickname: row.nickname, cocktailId: row.cocktail_id, cocktailName: row.cocktail_name, image: row.image, technique: row.technique, glass: row.glass, status: row.status, createdAt: row.created_at, completedAt: row.completed_at, ingredients: ingredients.map(i => {
      const currentKind = drinks.find(d => d.id === i.drinkId)?.kindId ?? i.kindId;
      const available = candidates(i.drinkId, currentKind, drinks);
      return { ...i, candidates: available, missing: row.status === 'pending' && (i.selectedId === null ? !available.length : !drinks.some(d => d.id === i.selectedId && d.available)) };
    }) };
  };
  app.get('/api/health', c => c.json({ ok: true }));
  app.get('/api/session', c => c.json({ guest: c.get('guest') }));
  app.post('/api/join', async c => {
    const { nickname } = await parseBody(c.req.raw);
    if (typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 24) return fail(400, 'ニックネームは1〜24文字で入力してください。');
    const existing = c.get('guest');
    const guest = { id: existing?.id || randomUUID(), nickname: nickname.trim() };
    db.prepare('INSERT INTO guests VALUES(?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname').run(guest.id, guest.nickname);
    setCookie(c, 'bar_guest', guest.id, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    return c.json({ guest });
  });
  app.get('/api/menu', c => {
    const query = new URL(c.req.url).searchParams;
    for (const key of ['min', 'max', 'kind', 'page']) {
      const value = query.get(key);
      if (value && (!Number.isFinite(Number(value)) || Number(value) < 0 || (['kind', 'page'].includes(key) && !Number.isInteger(Number(value))))) return fail(400, '絞り込み条件を確認してください。');
    }
    if (query.get('min') && query.get('max') && Number(query.get('min')) > Number(query.get('max'))) return fail(400, '度数の下限は上限以下にしてください。');
    return c.json(getMenu(db, query));
  });
  app.get('/api/cocktails/:id', c => {
    const cocktail = getCatalog(db).find(row => row.id === Number(c.req.param('id')));
    if (!cocktail) return fail(404, 'カクテルが見つかりません。');
    return c.json(cocktail);
  });
  app.get('/api/host/inventory', c => c.json({ drinks: getDrinks(db), availableCount: getCatalog(db).filter(row => row.available).length }));
  app.put('/api/host/inventory/:id', async c => {
    const drinkId = integer(Number(c.req.param('id')));
    const { available } = await parseBody(c.req.raw);
    if (typeof available !== 'boolean') return fail(400, '在庫の指定を確認してください。');
    if (STAPLES.has(drinkId)) return fail(400, '水と氷は常備品です。');
    if (!db.prepare('SELECT id FROM drinks WHERE id=?').get(drinkId)) return fail(404, '材料が見つかりません。');
    db.prepare('INSERT INTO inventory VALUES(?,?) ON CONFLICT(drink_id) DO UPDATE SET available=excluded.available').run(drinkId, +available);
    return c.json({ ok: true });
  });
  app.get('/api/orders', c => {
    const guest = c.get('guest');
    if (!guest) return fail(401, 'ニックネームを入力して参加してください。');
    const limit = 30;
    const page = pageNumber(c.req.query('page'));
    const rows = db.prepare('SELECT * FROM orders WHERE guest_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(guest.id, limit + 1, (page - 1) * limit) as DbOrder[];
    return c.json({ orders: rows.slice(0, limit).map(present), more: rows.length > limit });
  });
  app.post('/api/orders', async c => {
    const guest = c.get('guest');
    if (!guest) return fail(401, 'ニックネームを入力して参加してください。');
    const input = await parseBody(c.req.raw);
    const cocktailId = integer(input.cocktailId);
    if (typeof input.requestKey !== 'string' || !/^[\w-]{16,100}$/.test(input.requestKey)) return fail(400, '注文の送信情報を確認してください。');
    const requestKey = input.requestKey;
    const result = transaction(db, () => {
      const previous = db.prepare('SELECT * FROM orders WHERE guest_id=? AND request_key=?').get(guest.id, requestKey) as DbOrder | undefined;
      if (previous) { if (previous.cocktail_id !== cocktailId) fail(409, '別の注文としてもう一度操作してください。'); return previous; }
      const cocktail = getCatalog(db).find(row => row.id === cocktailId);
      if (!cocktail) return fail(404, 'カクテルが見つかりません。');
      if (!cocktail.available) return fail(409, '材料の在庫が変わったため、現在このカクテルは注文できません。');
      const ingredients: OrderIngredient[] = cocktail.ingredients.map(i => ({ recipeId: i.id, drinkId: i.drinkId, name: i.name, kindId: i.kindId, quantity: i.quantity, selectedId: i.substitute ? null : i.drinkId, selectedName: i.substitute ? null : i.name }));
      const id = randomUUID();
      db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, guest.id, guest.nickname, cocktail.id, cocktail.name, cocktail.image, cocktail.technique, cocktail.glass, 'pending', new Date().toISOString(), null, requestKey, JSON.stringify(ingredients));
      return findOrder(id)!;
    });
    return c.json(present(result), 201);
  });
  app.get('/api/host/orders', c => {
    const status = c.req.query('status') === 'completed' ? 'completed' : 'pending';
    const page = pageNumber(c.req.query('page'));
    const limit = 30;
    const rows = db.prepare(`SELECT * FROM orders WHERE status=? ORDER BY created_at ${status === 'pending' ? 'ASC' : 'DESC'},id LIMIT ? OFFSET ?`).all(status, limit + 1, (page - 1) * limit) as DbOrder[];
    const pendingCount = (db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='pending'").get() as {count:number}).count;
    return c.json({ orders: rows.slice(0, limit).map(present), more: rows.length > limit, pendingCount });
  });
  app.put('/api/host/orders/:id/ingredients/:recipeId', async c => {
    const selectedId = integer((await parseBody(c.req.raw)).drinkId);
    const updated = transaction(db, () => {
      const order = findOrder(c.req.param('id'));
      if (!order) return fail(404, '注文が見つかりません。');
      if (order.status === 'completed') return fail(409, '提供完了した注文は変更できません。');
      const ingredients = JSON.parse(order.ingredients) as OrderIngredient[];
      const ingredient = ingredients.find(i => i.recipeId === Number(c.req.param('recipeId')));
      if (!ingredient) return fail(404, '注文の材料が見つかりません。');
      const drinks = getDrinks(db);
      const currentKind = drinks.find(d => d.id === ingredient.drinkId)?.kindId ?? ingredient.kindId;
      const selected = candidates(ingredient.drinkId, currentKind, drinks).find(d => d.id === selectedId);
      if (!selected) return fail(409, '在庫が変わりました。現在使える材料から選び直してください。');
      ingredient.selectedId = selected.id; ingredient.selectedName = selected.name;
      db.prepare('UPDATE orders SET ingredients=? WHERE id=?').run(JSON.stringify(ingredients), order.id);
      return findOrder(order.id)!;
    });
    return c.json(present(updated));
  });
  app.post('/api/host/orders/:id/complete', async c => {
    await parseBody(c.req.raw);
    const updated = transaction(db, () => {
      const order = findOrder(c.req.param('id'));
      if (!order) return fail(404, '注文が見つかりません。');
      if (order.status === 'completed') return order;
      if ((JSON.parse(order.ingredients) as OrderIngredient[]).some(i => i.selectedId === null)) return fail(409, '使用した代用品を選んでください。');
      db.prepare("UPDATE orders SET status='completed',completed_at=? WHERE id=?").run(new Date().toISOString(), order.id);
      return findOrder(order.id)!;
    });
    return c.json(present(updated));
  });
  app.get('/api/host/connection', c => {
    let publicUrl: string | null = null;
    if (options.publicUrl) {
      let url: URL;
      try { url = new URL(options.publicUrl); } catch { return c.json({ publicUrl: null }); }
      if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) publicUrl = url.origin;
    }
    return c.json({ publicUrl });
  });
  app.all('/api/*', c => c.json({ error: '操作が見つかりません。' }, 404));
  return app;
}
