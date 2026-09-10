import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { verifyConfirmation } from './confirmation-browser';
import { mkdirSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { InviteQr } from '../src/InviteQr';
import { build } from 'vite';
import { setup } from './cloud-fixture';
import {
  verifyGuestPolling,
  verifyHostPolling,
  verifyGuestCompletedPolling,
} from './polling-browser';
// Only this separate test build uses synthetic Firebase settings.
const testDist = '.runtime/browser-build';
await build({
  logLevel: 'error',
  build: { outDir: testDist },
  define: {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify('browser-test-key'),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify('browser-test-project'),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify('browser-test-app'),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify('browser-test.firebaseapp.com'),
  },
});
const s = await setup();
const host = new Hono();
host.all('/api/*', (c) => s.app.fetch(c.req.raw, s.env));
host.use('*', serveStatic({ root: testDist }));
host.get('*', serveStatic({ path: `${testDist}/index.html` }));
const server = serve({ fetch: host.fetch, hostname: '127.0.0.1', port: 0 });
try {
  const a = await s.bootstrap('alice'),
    b = await s.bootstrap('bob');
  await s.request('/api/host/inventory/1', {
    uid: 'alice',
    method: 'PUT',
    body: { available: true },
  });
  const at = await s.invite('alice'),
    bt = await s.invite('bob');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  const origin = `http://127.0.0.1:${address.port}`;
  s.env.PUBLIC_APP_URL = origin;
  s.env.APP_ENV = 'local';
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByRole('heading', { name: '自宅を、あなたのバーに。' }).waitFor();
    await page.goto(`${origin}/join/${at}`);
    await page.getByLabel('ニックネーム').fill('スマホの客人');
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.waitForURL(`**/b/${a.id}`);

    await page.locator('.page-context').waitFor();
    await verifyGuestPolling(page, s, a.id, origin);
    assert.equal(await page.getByText('スマホの客人', { exact: true }).count(), 0);
    assert.equal(await page.locator('.account-strip').count(), 0);
    await page.getByRole('button', { name: '自分の注文', exact: true }).click();
    await page.getByText('スマホの客人 さんのご注文', { exact: true }).waitFor();
    await page.goto(`${origin}/b/${a.id}/cocktails/1`);
    assert.equal(await page.locator('.guest-identity').count(), 0);
    await page.getByRole('button', { name: 'このカクテルを1杯注文' }).click();
    await page.getByRole('heading', { name: 'ご注文を承りました' }).waitFor();
    await page.getByRole('button', { name: '注文状況を見る' }).click();
    await page.getByText('カクテル1', { exact: true }).waitFor();
    const orders = await s.request('/api/host/orders', { uid: 'alice' });
    const o = ((await orders.json()) as any).orders[0];
    assert.ok(o);
    await s.request(`/api/host/orders/${o.id}/complete`, {
      uid: 'alice',
      method: 'POST',
      body: {},
      customOrigin: origin,
    });
    await page.getByText('提供完了', { exact: true }).first().waitFor({ timeout: 15000 });
    await verifyGuestCompletedPolling(page, a.id);
    const second = await context.newPage();
    await second.goto(`${origin}/join/${bt}`);
    await second.getByLabel('ニックネーム').fill('同じ端末');
    await second.getByRole('button', { name: 'メニューを開く' }).click();
    await second.waitForURL(`**/b/${b.id}`);
    const cookies = await context.cookies();
    assert.equal(cookies.filter((c) => c.name === 'bar_guest').length, 2);
    await page.reload();
    await page.getByText('カクテル1', { exact: true }).waitFor();
    mkdirSync('.runtime/screenshots', { recursive: true });
    await page.screenshot({ path: '.runtime/screenshots/guest-orders.png', fullPage: true });

    // Long participant information and the stopped-service notice remain usable on every guest route.
    await page.route('**/session', async (route) => {
      const response = await route.fetch();
      const session = await response.json();
      await route.fulfill({
        json: {
          ...session,
          bar: { ...session.bar, name: '長いバーの名前'.repeat(8), acceptingOrders: false },
          guest: { ...session.guest, nickname: '長い客人の名前'.repeat(3) },
        },
      });
    });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const suffix of ['', '/orders', '/cocktails/1']) {
        await page.goto(`${origin}/b/${a.id}${suffix}`);
        await page.getByText('新しい注文の受付を停止しています。', { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      }
      await page.goto(`${origin}/b/${a.id}/orders`);
      await page.locator('.guest-identity').waitFor();
      await page.screenshot({
        path: `.runtime/screenshots/guest-identity-${width}.png`,
        fullPage: true,
      });
    }
    await page.unroute('**/session');
    await page.setViewportSize({ width: 390, height: 844 });
    await s.request('/api/host/invitation/rotate', {
      uid: 'alice',
      method: 'POST',
      body: {},
      customOrigin: origin,
    });
    await page.reload();
    await page.getByText('招待QRから参加し直してください。', { exact: true }).waitFor();
    // Decode the actual branded SVG, including its central logo, from browser pixels.
    const qrPage = await context.newPage();
    for (const inviteUrl of [
      `${origin}/join/${at}`,
      `https://millefleurs-staging.example.com/join/${at}`,
    ]) {
      const svg = renderToStaticMarkup(
        createElement(InviteQr, { code: QRCode.create(inviteUrl, { errorCorrectionLevel: 'H' }) }),
      );
      await qrPage.setContent(svg);
      const png = PNG.sync.read(await qrPage.locator('svg.invite-qr').screenshot());
      assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, inviteUrl);
    }
    await qrPage.close();
    const workerAsset = readdirSync(`${testDist}/assets`).find(
      (name) => name.startsWith('purchase.worker-') && name.endsWith('.js'),
    )!;
    const workerPage = await context.newPage();
    await workerPage.goto(origin);
    const workerResult = await workerPage.evaluate(async (asset) => {
      return await new Promise<{ addedCount: number }>((resolve, reject) => {
        const worker = new Worker(`/assets/${asset}`, { type: 'module' });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Worker timeout'));
        }, 20000);
        worker.onmessage = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
        };
        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage({
          limit: 1,
          drinks: [
            {
              id: 1,
              name: '材料',
              kindId: null,
              kindName: '材料',
              available: false,
              staple: false,
            },
          ],
          cocktails: [
            {
              id: 1,
              name: '一杯',
              available: false,
              ingredients: [{ drinkId: 1, kindId: null, name: '材料', quantity: '30ml' }],
            },
          ],
        });
      });
    }, workerAsset);
    assert.equal(workerResult.addedCount, 1);
    await workerPage.close();

    // Restore SDK persistence with synthetic users; Google OAuth itself needs real accounts.
    const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await hostContext.route('https://identitytoolkit.googleapis.com/**', async (route) => {
      const uid = route.request().postDataJSON()?.idToken;
      await route.fulfill({
        json: {
          users: [
            {
              localId: uid,
              email: `${uid}@example.com`,
              displayName: uid,
              emailVerified: true,
              providerUserInfo: [
                {
                  providerId: 'google.com',
                  rawId: uid,
                  displayName: uid,
                  email: `${uid}@example.com`,
                },
              ],
            },
          ],
        },
      });
    });
    const hostPage = await hostContext.newPage();
    hostPage.on('pageerror', (error) => errors.push(error.message));
    await hostPage.goto(origin);
    const restore = async (uid: string) => {
      await hostPage.evaluate(async (uid) => {
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('firebaseLocalStorageDb', 1);
          open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains('firebaseLocalStorage'))
              open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction('firebaseLocalStorage', 'readwrite');
            tx.objectStore('firebaseLocalStorage').put({
              fbase_key: 'firebase:authUser:browser-test-key:[DEFAULT]',
              value: {
                uid,
                email: `${uid}@example.com`,
                emailVerified: true,
                displayName: uid,
                isAnonymous: false,
                providerData: [
                  {
                    providerId: 'google.com',
                    uid,
                    displayName: uid,
                    email: `${uid}@example.com`,
                    photoURL: null,
                  },
                ],
                stsTokenManager: {
                  refreshToken: 'test-refresh',
                  accessToken: uid,
                  expirationTime: Date.now() + 3600000,
                },
                createdAt: String(Date.now()),
                lastLoginAt: String(Date.now()),
                apiKey: 'browser-test-key',
                appName: '[DEFAULT]',
              },
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      }, uid);
      await hostPage.goto(`${origin}/host/inventory`);
      await hostPage.getByRole('switch', { name: '材料1の在庫' }).waitFor();
    };
    await restore('alice');
    await verifyHostPolling(hostPage, origin);
    await hostPage.getByRole('button', { name: '注文', exact: true }).click();
    await hostPage.getByRole('button', { name: '注文数', exact: true }).click();
    await hostPage.getByRole('heading', { name: 'この家の注文数' }).waitFor();
    await hostPage.locator('.popularity-list li').first().waitFor();
    const countBefore = await hostPage.locator('.popularity-summary > strong').textContent();
    assert.notEqual(countBefore, '合計 0 杯');
    await hostPage.getByLabel('注文数をカクテル名で検索').fill('見つからない名前');
    await hostPage.getByText('該当するカクテルはありません。').waitFor();
    await hostPage.getByLabel('注文数をカクテル名で検索').fill('');
    await hostPage.locator('.popularity-list li').first().waitFor();
    await expect(hostPage.locator('.popularity-reset')).toContainText(
      'リセット後は0から集計します。',
    );
    await expect(hostPage.locator('.popularity-summary')).not.toContainText('リセット後');
    await verifyConfirmation(hostPage, {
      trigger: '注文数をリセット',
      title: '注文数をリセットしますか？',
      confirm: '全注文数を0にする',
      pending: 'リセット中…',
      endpoint: '**/api/host/order-counts/reset',
      screenshot: 'confirm-reset',
    });
    assert.equal(await hostPage.locator('.popularity-summary > strong').textContent(), countBefore);
    for (const width of [320, 390, 768, 1280]) {
      await hostPage.setViewportSize({ width, height: 844 });
      assert.ok(await hostPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await hostPage.screenshot({
        path: `.runtime/screenshots/host-popularity-${width}.png`,
        fullPage: true,
      });
    }
    await hostPage.setViewportSize({ width: 390, height: 844 });
    await hostPage.getByRole('button', { name: '注文数をリセット', exact: true }).click();
    await hostPage.getByRole('button', { name: '全注文数を0にする', exact: true }).click();
    await hostPage.getByText('合計 0 杯', { exact: true }).waitFor();
    await hostPage.getByText('注文数をリセットしました。').waitFor();
    await expect(hostPage.getByRole('dialog')).toHaveCount(0);
    await expect(
      hostPage.getByRole('button', { name: '注文数をリセット', exact: true }),
    ).toBeFocused();
    await hostPage.getByRole('button', { name: '提供完了の履歴', exact: true }).click();
    await hostPage.locator('.order-card').first().waitFor();

    await hostPage.getByRole('button', { name: '在庫', exact: true }).click();
    await hostPage.getByRole('switch', { name: '材料1の在庫' }).waitFor();
    assert.equal(
      await hostPage.getByRole('switch', { name: '材料1の在庫' }).getAttribute('aria-checked'),
      'true',
    );
    await hostPage.getByRole('button', { name: 'お迎え', exact: true }).click();
    await hostPage.getByLabel('バーの名前').fill('テストのホームバー');
    await hostPage.getByRole('button', { name: '名前を保存' }).click();
    await hostPage.getByRole('button', { name: '受付を停止する' }).click();
    await hostPage.getByRole('button', { name: '受付を開始する' }).waitFor();
    await hostPage
      .locator('svg.invite-qr')
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const invitePng = PNG.sync.read(
      await hostPage
        .locator('svg.invite-qr')
        .screenshot({ path: '.runtime/screenshots/host-qr.png' }),
    );
    await hostPage.screenshot({ path: '.runtime/screenshots/host-invitation.png', fullPage: true });
    assert.equal(
      jsQR(new Uint8ClampedArray(invitePng.data), invitePng.width, invitePng.height)?.data,
      await hostPage.getByLabel('参加用URL').inputValue(),
    );

    const invitationBefore = await hostPage.getByLabel('参加用URL').inputValue();
    await verifyConfirmation(hostPage, {
      trigger: '招待リンクを再発行',
      title: '招待リンクを再発行しますか？',
      confirm: '再発行する',
      pending: '再発行中…',
      endpoint: '**/api/host/invitation/rotate',
      screenshot: 'confirm-invitation',
    });
    assert.equal(await hostPage.getByLabel('参加用URL').inputValue(), invitationBefore);
    await hostPage.getByRole('button', { name: '招待リンクを再発行', exact: true }).click();
    await hostPage
      .getByRole('dialog')
      .getByRole('button', { name: '再発行する', exact: true })
      .click();
    await hostPage.getByText('招待リンクを再発行しました。').waitFor();
    await expect(hostPage.getByLabel('参加用URL')).not.toHaveValue(invitationBefore);
    await expect(hostPage.getByRole('dialog')).toHaveCount(0);
    await expect(
      hostPage.getByRole('button', { name: '招待リンクを再発行', exact: true }),
    ).toBeFocused();

    assert.equal(
      await hostPage.getByRole('button', { name: 'ログアウト', exact: true }).count(),
      0,
    );
    await hostPage.getByRole('button', { name: 'アカウント', exact: true }).click();
    await hostPage.getByRole('heading', { name: 'アカウント', exact: true }).waitFor();
    await hostPage.getByRole('heading', { name: 'alice', exact: true }).waitFor();
    await hostPage.getByText('alice@example.com', { exact: true }).waitFor();
    assert.equal(
      await hostPage
        .getByRole('button', { name: 'アカウント', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
    await hostPage.reload();
    await hostPage.getByRole('heading', { name: 'alice', exact: true }).waitFor();
    await hostPage.screenshot({ path: '.runtime/screenshots/host-account.png', fullPage: true });
    for (const width of [320, 390, 768, 1280]) {
      await hostPage.setViewportSize({ width, height: 844 });
      await hostPage.locator('.account-details h2').evaluate((el) => {
        el.textContent = '長い家主の名前'.repeat(12);
      });
      assert.equal(
        await hostPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await hostPage.screenshot({
        path: `.runtime/screenshots/host-account-${width}.png`,
        fullPage: true,
      });
    }
    await hostPage.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await hostPage.getByRole('button', { name: 'Googleで登録・ログイン' }).waitFor();
    await restore('bob');
    assert.equal(
      await hostPage.getByRole('switch', { name: '材料1の在庫' }).getAttribute('aria-checked'),
      'false',
    );
    await hostContext.close();

    assert.deepEqual(errors, []);
    console.log(
      'Browser: mobile guest join → order → completion; two bar cookies; invitation revocation; branded QR image decoding; host settings and account switching passed.',
    );
  } finally {
    await browser.close();
  }
} finally {
  server.close();
  await s.mf.dispose();
}
