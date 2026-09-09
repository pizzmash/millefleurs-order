import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import type { setup } from './cloud-fixture';

function requests(page: Page) {
  const counts = new Map<string, number>();
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const path = new URL(request.url()).pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  });
  return (path: string) => counts.get(path) ?? 0;
}

export async function verifyGuestPolling(
  page: Page,
  s: Awaited<ReturnType<typeof setup>>,
  barId: string,
  origin: string,
) {
  const count = requests(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const menuPath = `/api/b/${barId}/menu`;
  const sessionPath = `/api/b/${barId}/session`;
  await page.getByRole('heading', { name: '今夜のメニュー' }).waitFor();
  await page.clock.runFor(7000);
  assert.equal(count(menuPath), 0, 'menu must not poll');
  assert.equal(count(sessionPath), 0, 'session must not poll every 3 seconds');
  const manual = page.waitForResponse((r) => new URL(r.url()).pathname === menuPath);
  await page.getByRole('button', { name: 'メニューを更新', exact: true }).click();
  await manual;
  assert.equal(count(menuPath), 1);
  // Focus restoration refreshes once; periodic polling stays disabled.
  await page.clock.runFor(2000);
  const focus = page.waitForResponse((r) => new URL(r.url()).pathname === menuPath);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await focus;
  assert.equal(count(menuPath), 2);
  await page.clock.runFor(7000);
  assert.equal(count(menuPath), 2);
  const sessionCount = count(sessionPath);
  const session = page.waitForResponse((r) => new URL(r.url()).pathname === sessionPath);
  await page.clock.runFor(61000);
  await session;
  assert.ok(count(sessionPath) > sessionCount);
  assert.equal(count(menuPath), 2);

  // A stale detail must reject the order and refresh its availability.
  await page.goto(`${origin}/b/${barId}/cocktails/1`);
  await page.getByRole('button', { name: 'このカクテルを1杯注文' }).waitFor();
  const detailPath = `/api/b/${barId}/cocktails/1`;
  const detailCount = count(detailPath);
  await page.clock.runFor(7000);
  assert.equal(count(detailPath), detailCount, 'detail must not poll');
  const inventory = (available: boolean) =>
    s.request('/api/host/inventory/1', {
      uid: 'alice',
      method: 'PUT',
      body: { available },
      customOrigin: origin,
    });
  assert.equal((await inventory(false)).status, 200);
  await page.getByRole('button', { name: 'このカクテルを1杯注文' }).click();
  await expect(page.getByRole('button', { name: '現在、材料が不足しています' })).toBeDisabled();
  assert.equal((await inventory(true)).status, 200);
  await page.getByRole('button', { name: '最新の在庫を確認' }).click();
  await expect(page.getByRole('button', { name: 'このカクテルを1杯注文' })).toBeEnabled();
  await page.clock.resume();
  await page.goto(`${origin}/b/${barId}`);
  await page.locator('.page-context').waitFor();
}

export async function verifyHostPolling(page: Page, origin: string) {
  const count = requests(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.clock.runFor(7000);
  assert.equal(count('/api/host/inventory'), 0, 'inventory must not poll');
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.runtime/screenshots/inventory-refresh-320.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  // Mutation still refreshes immediately and updates the switch.
  const toggle = page.getByRole('switch', { name: '材料1の在庫' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await page.getByText('買い足しで増やす', { exact: true }).click();
  await page.getByRole('button', { name: 'おすすめを計算' }).click();
  await expect(page.locator('.purchase-count')).toHaveText('現在 2 → 購入後 2種類');
  assert.equal(count('/api/host/purchase-source'), 1);
  assert.equal(count('/api/host/versions'), 1);
  await page.route('**/api/host/versions', async (route) => {
    const response = await route.fetch();
    const versions = await response.json();
    await route.fulfill({ json: { ...versions, inventoryVersion: versions.inventoryVersion + 1 } });
  });
  await page.getByRole('button', { name: 'おすすめを計算' }).click();
  await page
    .getByText('在庫またはレシピが変わりました。再計算してください。', { exact: true })
    .waitFor();
  await expect(page.locator('.purchase-result')).toHaveCount(0);
  await page.unroute('**/api/host/versions');

  await page.goto(`${origin}/host`);
  await page.getByText('客人からの注文をここで確認できます。').waitFor();
  let baseline = count('/api/host/orders');
  await page.clock.runFor(3500);
  await expect.poll(() => count('/api/host/orders')).toBeGreaterThan(baseline);
  // Hide the page: polling stops. Restoring visibility fetches immediately.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  baseline = count('/api/host/orders');
  await page.clock.runFor(7000);
  assert.equal(count('/api/host/orders'), baseline);
  const visible = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/host/orders');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await visible;
  await page.getByRole('button', { name: '提供完了の履歴' }).click();
  await page.getByText('カクテル1', { exact: true }).waitFor();
  baseline = count('/api/host/orders');
  await page.clock.runFor(7000);
  assert.equal(
    count('/api/host/orders'),
    baseline,
    'completed orders must not poll every 3 seconds',
  );
  const slow = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/host/orders');
  await page.clock.runFor(30000);
  await slow;
  assert.ok(count('/api/host/orders') > baseline);
  await page.getByRole('button', { name: 'お迎え', exact: true }).click();
  await page.getByLabel('バーの名前').waitFor();
  baseline = count('/api/host/invitation');
  await page.clock.runFor(7000);
  assert.equal(count('/api/host/invitation'), baseline, 'invitation must not poll');
  await page.clock.resume();
}

export async function verifyGuestCompletedPolling(page: Page, barId: string) {
  const count = requests(page);
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
  const path = `/api/b/${barId}/orders`;
  await page.clock.runFor(7000);
  assert.equal(count(path), 0, 'fully completed guest orders must slow down');
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === path);
  await page.clock.runFor(30000);
  await refreshed;
  assert.ok(count(path) > 0);
  await page.clock.resume();
}
