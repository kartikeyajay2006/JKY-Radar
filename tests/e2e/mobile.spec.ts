import { expect, test } from '@playwright/test';

test('mobile layout has no horizontal scroll and the menu works', async ({ page }) => {
  for (const path of ['/', '/demo', '/docs', '/login']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: 'Live demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
});
