import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';

export async function verifyConfirmation(
  page: Page,
  options: {
    trigger: string;
    title: string;
    confirm: string;
    pending: string;
    endpoint: string;
    screenshot: string;
  },
) {
  const trigger = page.getByRole('button', { name: options.trigger, exact: true });
  const dialog = page.getByRole('dialog', { name: options.title, exact: true });
  const cancel = dialog.getByRole('button', { name: 'キャンセル', exact: true });
  const confirm = dialog.getByRole('button', { name: options.confirm, exact: true });
  let requests = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(options.endpoint, async (route) => {
    requests++;
    await held;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '確認操作の失敗テスト' }),
    });
  });
  try {
    await trigger.click();
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    // Some browsers focus the dialog itself for one step before wrapping.
    if (!(await cancel.evaluate((el) => el === document.activeElement)))
      await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.equal(requests, 0);
    await trigger.click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await dialog.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
      assert.ok((await cancel.boundingBox())!.height >= 48);
      assert.ok((await confirm.boundingBox())!.height >= 48);
      assert.ok(
        (await confirm.boundingBox())!.height <= 52,
        'Confirmation label stays on one line',
      );
      await page.screenshot({ path: `.runtime/screenshots/${options.screenshot}-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 320 });
    await expect(confirm).toBeVisible();
    await confirm.scrollIntoViewIfNeeded();
    const smallBounds = await confirm.boundingBox();
    assert.ok(smallBounds && smallBounds.y >= 0 && smallBounds.y + smallBounds.height <= 320);
    await page.setViewportSize({ width: 390, height: 844 });
    await confirm.click();
    await expect(dialog.getByRole('button', { name: options.pending, exact: true })).toBeDisabled();
    await expect(cancel).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByRole('alert')).toHaveText('確認操作の失敗テスト');
    await expect(confirm).toBeEnabled();
    await expect(cancel).toBeEnabled();
    assert.equal(requests, 1);
    await cancel.click();
    await expect(trigger).toBeFocused();
  } finally {
    release();
    await page.unroute(options.endpoint);
  }
}
